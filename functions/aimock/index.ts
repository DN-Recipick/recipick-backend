// supabase/functions/aimock/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    })
  }
  
  if (req.method !== "POST") {
    return jsonResponse({
      error: "Method not allowed"
    }, 405);
  }
  
  try {
    const body = await req.json();
    const { video_id, recipe_id } = body;
    
    if (!video_id || typeof video_id !== "string") {
      return jsonResponse({
        error: "Invalid video_id"
      }, 400);
    }
    
    // 즉시 성공 응답 반환
    const response = jsonResponse({
      message: "Processing started",
      video_id: video_id,
      recipe_id: recipe_id
    });
    
    // 10초 후에 기존 서버로 POST 요청 보내기 (비동기)
    setTimeout(async () => {
      try {
        const mockData = {
          video_id: video_id,
          title: "목데이터 영상제목",
          name: "목데이터 레시피이름",
          channel: "목데이터 영상채널",
          item: [
            "1. 김치를 꺼내요",
            "2. 된장을 꺼내요",
            "3. 아무튼 물을 넣고 끓여요",
            "4. 접시에 담아요"
          ],
          ingredients: [
            {
              name: "김치",
              amount: "한포기"
            },
            {
              name: "된장",
              amount: "100g"
            },
            {
              name: "시래기",
              amount: "한단"
            }
          ]
        };
        
        // 기존 서버로 POST 요청 보내기
        const processResponse = await fetch("https://kgmlwbdrhyuzgixvsyms.supabase.co/functions/v1/recipe/process", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            recipe_id: recipe_id,
            ...mockData
          })
        });
        
        if (!processResponse.ok) {
          console.error("Failed to send data to process endpoint:", processResponse.status);
        } else {
          console.log("Successfully sent data to process endpoint for video_id:", video_id);
        }
      } catch (error) {
        console.error("Error sending data to process endpoint:", error);
      }
    }, 10000); // 10초 대기
    
    return response;
    
  } catch (err) {
    return jsonResponse({
      error: "Invalid request body"
    }, 400);
  }
});
