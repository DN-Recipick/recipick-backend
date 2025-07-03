import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

function jsonResponse(body: any, status = 200) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    }
  )
}

const supabase = (req: any) => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');

serve(async (req: any) => {
  const { pathname } = new URL(req.url);
  const method = req.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    })
  }

  // GET /recommend/{recipeId}
  if (method === "GET" && pathname.match(/^\/recommend\/([^\/]+)$/)) {
    try {
      const pathMatch = pathname.match(/^\/recommend\/([^\/]+)$/);
      const recipeId = pathMatch![1];
      // JWT 토큰에서 유저 정보 추출
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return jsonResponse("Unauthorized - Missing or invalid token", 401);
      }
      const token = authHeader.replace('Bearer ', '');
      const supabaseClient = supabase(req);
      // 토큰 검증 및 유저 정보 가져오기
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse("Unauthorized - Invalid token", 401);
      }
      // 대상 레시피 정보 가져오기
      const { data: targetRecipe, error: targetError } = await supabaseClient
        .from("recipe")
        .select("*")
        .eq("id", recipeId)
        .single();
      if (targetError || !targetRecipe) {
        return jsonResponse("Recipe not found", 404);
      }
      // 메뉴 기반 추천
      let byMenu: any[] = [];
      if (targetRecipe.title || targetRecipe.name) {
        const searchTerms = [];
        if (targetRecipe.title) searchTerms.push(targetRecipe.title);
        if (targetRecipe.name) searchTerms.push(targetRecipe.name);
        const keywords = searchTerms
          .join(' ')
          .split(/[\s,]+/)
          .filter((word: string) => word.length > 1)
          .slice(0, 3);
        if (keywords.length > 0) {
          const { data: menuRecipes, error: menuError } = await supabaseClient
            .from("recipe")
            .select("*")
            .or(keywords.map((keyword: string) => `title.ilike.%${keyword}%,name.ilike.%${keyword}%`).join(','))
            .neq("id", recipeId)
            .eq("state", 1)
            .limit(5);
          if (!menuError && menuRecipes) {
            byMenu = menuRecipes;
          }
        }
      }
      // 재료 기반 추천
      let byIngredients: any[] = [];
      if (targetRecipe.ingredients && targetRecipe.ingredients.length > 0) {
        const targetIngredientNames = targetRecipe.ingredients
          .map((ing: any) => ing.name)
          .filter((name: string) => name && name.length > 0);
        if (targetIngredientNames.length > 0) {
          const orQuery = targetIngredientNames.slice(0, 5)
            .map((name: string) => `ingredients->>name.ilike.%${name}%`).join(',');
          const { data: candidateRecipes, error: candidateError } = await supabaseClient
            .from("recipe")
            .select("*")
            .neq("id", recipeId)
            .eq("state", 1)
            .or(orQuery)
            .limit(50);
          if (!candidateError && candidateRecipes) {
            const recipesWithScore = candidateRecipes.map(recipe => {
              if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) {
                return { ...recipe, matchScore: 0 };
              }
              const recipeIngredientNames = recipe.ingredients
                .map((ing: any) => ing.name)
                .filter((name: string) => name && name.length > 0);
              const matchingIngredients = targetIngredientNames.filter((targetName: string) =>
                recipeIngredientNames.some((recipeName: string) =>
                  recipeName.toLowerCase().includes(targetName.toLowerCase()) ||
                  targetName.toLowerCase().includes(recipeName.toLowerCase())
                )
              );
              const matchScore = matchingIngredients.length;
              return {
                ...recipe,
                matchScore
              };
            });
            byIngredients = recipesWithScore
              .filter(recipe => recipe.matchScore > 0)
              .sort((a, b) => b.matchScore - a.matchScore)
              .slice(0, 5)
              .map(recipe => ({
                id: recipe.id,
                title: recipe.title,
                name: recipe.name,
                channel: recipe.channel,
                item: recipe.item,
                ingredients: recipe.ingredients,
                state: recipe.state,
                created_at: recipe.created_at,
                video_id: recipe.video_id
              }));
          }
        }
      }
      // 부족한 경우 랜덤 추천으로 보완
      if (byMenu.length < 5) {
        const { data: randomMenuRecipes, error: randomMenuError } = await supabaseClient
          .from("recipe")
          .select("*")
          .neq("id", recipeId)
          .eq("state", 1)
          .limit(5 - byMenu.length);
        if (!randomMenuError && randomMenuRecipes) {
          byMenu = [...byMenu, ...randomMenuRecipes];
        }
      }
      if (byIngredients.length < 5) {
        const { data: randomIngredientRecipes, error: randomIngredientError } = await supabaseClient
          .from("recipe")
          .select("*")
          .neq("id", recipeId)
          .eq("state", 1)
          .limit(5 - byIngredients.length);
        if (!randomIngredientError && randomIngredientRecipes) {
          byIngredients = [...byIngredients, ...randomIngredientRecipes];
        }
      }
      return jsonResponse({
        recommends: {
          by_menu: byMenu.slice(0, 5),
          by_ingredients: byIngredients.slice(0, 5)
        }
      });
    } catch (err) {
      console.error("Recommend endpoint error:", err);
      return jsonResponse("Internal server error", 500);
    }
  }

  return jsonResponse("Method Not Allowed", 405);
}); 