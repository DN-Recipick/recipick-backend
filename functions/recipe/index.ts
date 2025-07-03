// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = (req: any) => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');

// YouTube URL에서 video_id 추출하는 함수
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

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

serve(async (req1: any) => {
  if (req1.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    })
  }
  const { pathname } = new URL(req1.url);
  const method = req1.method;
  // GET /recipe or GET /recipe/:id
  if (method === "GET") {
    const pathMatch = pathname.match(/^\/recipe(?:\/([^\/]+))?$/);
    if (!pathMatch) {
      return jsonResponse("Not Found", 404);
    }
    
    const id = pathMatch[1];
    
    // JWT 토큰에서 유저 정보 추출
    const authHeader = req1.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse("Unauthorized - Missing or invalid token", 401);
    }
    
    const token = authHeader.replace('Bearer ', '');
    const supabaseClient = supabase(req1);
    
    // 토큰 검증 및 유저 정보 가져오기
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse("Unauthorized - Invalid token", 401);
    }
    
    if (id) {
      // GET /recipe/:id - 특정 레시피 상세 정보
      try {
        // user_recipe 테이블을 통해 유저가 접근 권한이 있는지 확인
        const { data: userRecipe, error: userRecipeError } = await supabaseClient
          .from("user_recipe")
          .select("recipe_id")
          .eq("user_id", user.id)
          .eq("recipe_id", id)
          .single();
        
        if (userRecipeError || !userRecipe) {
          return jsonResponse("Recipe not found or access denied", 404);
        }
        
        // recipe 테이블에서 레시피 정보 가져오기
        const { data: recipe, error: recipeError } = await supabaseClient
          .from("recipe")
          .select("*")
          .eq("id", id)
          .single();
        
        if (recipeError || !recipe) {
          return jsonResponse("Recipe not found", 404);
        }
        
        return jsonResponse(recipe);
        
      } catch (err) {
        console.error("Error fetching recipe detail:", err);
        return jsonResponse("Internal server error", 500);
      }
    } else {
      // GET /recipe - 유저와 연관된 모든 레시피 리스트
      try {
        // user_recipe 테이블을 통해 유저가 저장한 레시피 ID들 가져오기
        const { data: userRecipes, error: userRecipesError } = await supabaseClient
          .from("user_recipe")
          .select(`
            recipe_id,
            created_at,
            recipe:recipe_id (
              id,
              video_id,
              title,
              name,
              channel,
              item,
              ingredients,
              state
            )
          `)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        
        if (userRecipesError) {
          console.error("Error fetching user recipes:", userRecipesError);
          return jsonResponse("Database error", 500);
        }
        
        // 응답 데이터 정리
        const recipes = userRecipes.map(ur => ({
          ...ur.recipe,
          created_at: ur.created_at
        }));
        
        return jsonResponse({
          recipes: recipes,
          count: recipes.length
        });
        
      } catch (err) {
        console.error("Error fetching user recipes:", err);
        return jsonResponse("Internal server error", 500);
      }
    }
  }
  // POST /recipe
  if (method === "POST" && pathname === "/recipe") {
    try {
      // JWT 토큰에서 유저 정보 추출
      const authHeader = req1.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return jsonResponse("Unauthorized - Missing or invalid token", 401);
      }
      
      const token = authHeader.replace('Bearer ', '');
      const supabaseClient = supabase(req1);
      
      // 토큰 검증 및 유저 정보 가져오기
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse("Unauthorized - Invalid token", 401);
      }
      
      const { url: targetUrl } = await req1.json();
      if (!targetUrl) {
        return jsonResponse("Missing 'url' in request body", 400);
      }
      
      // YouTube URL에서 video_id 추출
      const videoId = extractVideoId(targetUrl);
      if (!videoId) {
        return jsonResponse("Invalid YouTube URL", 400);
      }
      
      // 기존 recipe 테이블에서 video_id로 검색
      const { data: existingRecipe, error: searchError } = await supabaseClient
        .from("recipe")
        .select("*")
        .eq("video_id", videoId)
        .single();
      
      if (searchError && searchError.code !== 'PGRST116') { // PGRST116는 결과가 없는 경우
        console.error("Recipe search error:", searchError);
        return jsonResponse("Database search error", 500);
      }
      
      let recipeId: number;
      
      if (existingRecipe) {
        // 기존 레시피가 있는 경우
        recipeId = existingRecipe.id;
        console.log(`Existing recipe found with video_id: ${videoId}`);
      } else {
        // 기존 레시피가 없는 경우, video_id만으로 새 레시피 생성
        const { data: newRecipe, error: insertError } = await supabaseClient
          .from("recipe")
          .insert({
            video_id: videoId,
            title: null,
            name: null,
            channel: null,
            item: null,
            ingredients: null
          })
          .select()
          .single();
        
        if (insertError) {
          console.error("Recipe insert error:", insertError);
          return jsonResponse("Database insert error", 500);
        }
        
        recipeId = newRecipe.id;
        console.log(`New recipe created with video_id: ${videoId}`);
        
        // 외부 서버에 비동기 요청 보내기 (응답을 기다리지 않음)
        fetch("https://kgmlwbdrhyuzgixvsyms.supabase.co/functions/v1/aimock", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            video_id: videoId,
            recipe_id: recipeId
          })
        }).catch(error => {
          console.error("External server request failed:", error);
          // 외부 서버 요청 실패는 로그만 남기고 사용자에게는 성공 응답
        });
      }
      
      // user_recipe 테이블에 유저와 레시피 관계 저장
      const { error: userRecipeError } = await supabaseClient
        .from("user_recipe")
        .insert({
          user_id: user.id,
          recipe_id: recipeId,
          created_at: new Date().toISOString()
        });
      
      if (userRecipeError) {
        console.error("User recipe insert error:", userRecipeError);
        return jsonResponse("Failed to link user with recipe", 500);
      }
      
      return jsonResponse({
        message: existingRecipe ? "Recipe linked to user" : "Recipe created and linked to user",
        recipe_id: recipeId,
        user_id: user.id,
        video_id: videoId,
        is_new_recipe: !existingRecipe
      }, 201);
    } catch (err) {
      console.error("Unexpected error:", err);
      return jsonResponse("Internal server error", 500);
    }
  }
  
  // POST /recipe/process - aimock에서 보낸 데이터로 recipe 업데이트 (인증 없음)
  if (method === "POST" && pathname === "/recipe/process") {
    try {
      const { recipe_id, video_id, title, name, channel, item, ingredients } = await req1.json();
      
      if (!recipe_id) {
        return jsonResponse("Missing 'recipe_id' in request body", 400);
      }
      
      const supabaseClient = supabase(req1);
      
      // recipe 테이블 업데이트
      const { error: updateError } = await supabaseClient
        .from("recipe")
        .update({
          title: title,
          name: name,
          channel: channel,
          item: item,
          ingredients: ingredients,
          state: 1
        })
        .eq("id", recipe_id);
      
      if (updateError) {
        console.error("Recipe update error:", updateError);
        return jsonResponse("Database update error", 500);
      }
      
      return jsonResponse({
        message: "Recipe updated successfully",
        recipe_id: recipe_id,
        video_id: video_id
      });
      
    } catch (err) {
      console.error("Process endpoint error:", err);
      return jsonResponse("Internal server error", 500);
    }
  }

  
  return jsonResponse("Method Not Allowed", 405);
});
