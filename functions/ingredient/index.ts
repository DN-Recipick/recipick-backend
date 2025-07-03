// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

console.log("Hello from Functions!")

interface MarketKurlyProduct {
  no: number;
  name: string;
  shortDescription: string;
  listImageUrl: string;
  productVerticalMediumUrl: string;
  salesPrice: number;
  discountedPrice: number | null;
  discountRate: number;
  position: number;
}

interface MarketKurlyListSection {
  view: {
    sectionCode: string;
    version: string;
  };
  data: {
    items: MarketKurlyProduct[];
  };
}

interface MarketKurlyResponse {
  success: boolean;
  message: string | null;
  data: {
    topSections: any[];
    listSections: MarketKurlyListSection[];
  };
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
  const { pathname, searchParams } = new URL(req.url);
  const method = req.method;

  // GET /ingredient
  if (method === "GET" && pathname === "/ingredient") {
    try {
      const keyword = searchParams.get("keyword");
      
      if (!keyword) {
        return jsonResponse([]);
      }

      // 마켓컬리 API 호출
      const marketKurlyResponse = await fetch(`https://api.kurly.com/search/v4/sites/market/normal-search?keyword=${encodeURIComponent(keyword)}&page=1&sortType=4`, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
          "Referer": "https://www.kurly.com/",
          "Origin": "https://www.kurly.com"
        }
      });

      if (!marketKurlyResponse.ok) {
        console.error("Market Kurly API error:", marketKurlyResponse.status);
        return jsonResponse([]);
      }

      const marketKurlyData: MarketKurlyResponse = await marketKurlyResponse.json();
      
      // 상품 리스트 추출
      let products: MarketKurlyProduct[] = [];
      if (marketKurlyData.data && marketKurlyData.data.listSections && marketKurlyData.data.listSections.length > 0) {
        const firstSection = marketKurlyData.data.listSections[0];
        if (firstSection.data && firstSection.data.items) {
          products = firstSection.data.items;
        }
      }
      
      // 상위 5개 결과만 추출하고 응답 형식에 맞게 변환
      const result = products
        .slice(0, 5)
        .map(product => ({
          no: product.no.toString(),
          name: product.name,
          price: product.discountedPrice ? product.discountedPrice.toString() : product.salesPrice.toString(),
          imageUrl: product.listImageUrl
        }));

      return jsonResponse(result);

    } catch (error) {
      console.error("Ingredient API error:", error);
      return jsonResponse([]);
    }
  }

  // 다른 HTTP 메서드에 대한 응답
  return new Response("Method Not Allowed", {
    status: 405
  });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ingredient' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
