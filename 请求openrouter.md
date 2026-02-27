通过 hasura 请求 openrouter 接口
AI 请求
请求地址：https://hasura-auth-worker.data-d1a.workers.dev/
额外请求头
{
  "Authorization": "Bearer xxxxxxxx"
}
Graphql
mutation ProxyToOpenRouter($req: SampleInput!) {
  OpenRouterCreateCompletionsForMaterial(req: $req) {
    choices {
      index
      finish_reason
      message {
        role
        # 👇👇👇 必须加上这一行！ 👇👇👇
        content 
        # 👆👆👆 必须加上这一行！ 👆👆👆
        
        tool_calls {
          id
          type
          function {
            name
            arguments
          }
        }
      }
    }
    usage {
      total_tokens
      prompt_tokens
      completion_tokens
    }
    error {
      message
      code
    }
  }
}
1. openai/gpt-5-mini + 图片
请求体示例
{
  "req": {
    "model": "openai/gpt-5-mini",
    "response_format": {
      "type": "json_object"
    },
    "messages": [
      {
        "role": "user",
        "content": "[{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://storage.googleapis.com/download/storage/v1/b/pl_apify/o/Instagram%20Mentions%20Scraper%2Fjwpei_official%2FSidecar%2F2026%2F01%2F6%2Fcori_oliva%2F3803722363095343330%2F610626609_18554625109015474_3064467793876568495_n.jpg?generation=1767666796258899&alt=media\"}},{\"type\":\"text\",\"text\":\"──────────────────────────────────────────────────────────────\\nJW PEI · SINGLE-IMAGE REVIEW GUIDE\\n──────────────────────────────────────────────────────────────\\n\\n0 · QUICK WORKFLOW\\n1) Open the image.\\n2) Is a JW PEI product clearly visible **and** ≥ 30 % of the frame?\\n · **No** → set `categoryCode = \\\"NOPD\\\"`, output JSON, done.\\n · **Yes** → go on.\\n3) Starting from Category 1 below, stop at the **first** rule that matches; copy\\n both `categoryName` and `categoryCode`.\\n4) Fill **all** flags & metrics (Section 2).\\n5) Write a one-sentence `note` (≤ 80 ASCII chars) that justifies the category.\\n6) Choose a `confidence` value (see bands in Section 3).\\n7) Return exactly **one** JSON object using the template in Section 4.\\n\\n──────────────────────────────────────────────────────────────\\n1 · CATEGORIES (evaluate in this order)\\n──────────────────────────────────────────────────────────────\\n1. **NOPD – No Product / Skip**\\n • No JW PEI item visible, **or** visible item covers < 30 % of pixels.\\n\\n2. **WHJW – Influencer Still Life**\\n • No people present.\\n • JW PEI product ≥ 30 % of frame.\\n • At most 2 decorative props.\\n • Example: bag on café table with a coffee cup.\\n\\n3. **WHMT – Influencer Model**\\n • At least one person is wearing or holding the product.\\n • ≥ 70 % of product outline visible.\\n • Back or side faces allowed.\\n • If stickers / mosaic hide eyes-nose-mouth → set `faceOccluded = true`.\\n • Must set `modelGender`.\\n\\n4. **LBKP – Lookbook**\\n • Clean studio shot: solid / gradient background, centred item, even light.\\n • White-background colour-swatch images also count.\\n\\n5. **CLLG – Collage**\\n • One file that is a stitched collage of ≥ 2 products *or* ≥ 2 distinct scenes.\\n\\n6. **AIGC – AI-Generated**\\n • Entire image appears CGI / AI: plastic textures, impossible shadows,\\n AI watermarks, “alpha” ghosts.\\n • Light retouch is **not** enough for AIGC.\\n\\n7. **XXDD – Disallowed**\\n • Obscene gesture, explicit nudity, hate symbols/text, or large competitor logo.\\n\\nStop as soon as one rule matches; do **not** evaluate lower categories.\\n\\n──────────────────────────────────────────────────────────────\\n2 · FLAGS & METRICS — HOW TO SET THEM\\n──────────────────────────────────────────────────────────────\\n• `containsCompetitorLogo` — true if a non-JW PEI logo covers ≥ 30 % of frame\\n• `containsNonVegFood` — true if meat or seafood is clearly visible\\n• `faceOccluded` — true only when eyes-nose-mouth hidden by sticker/mask\\n• `peopleCount` — count visible heads\\n• `displayCoveragePercent` — rough (product pixels ÷ image pixels) × 100\\n• `lightingCondition` — \\\"good\\\", \\\"poor\\\", or \\\"filtered\\\" (strong colour tint)\\n• `backgroundClutterLevel` — \\\"low\\\", \\\"medium\\\", or \\\"high\\\"\\n• `containsInfant` — true if baby ≤ 2 yrs present\\n• `containsPregnantPerson` — true if pregnancy visibly obvious\\n• `containsVulgarContent` — true for rude gesture/text\\n• `isBlackWhiteFilter` — **true** if the whole image is black-and-white / grayscale; false otherwise\\n• `modelGender` — \\\"female\\\", \\\"male\\\", \\\"mixed\\\", or \\\"unknown\\\"\\n──────────────────────────────────────────────────────────────\\n3 · NOTE & CONFIDENCE\\n──────────────────────────────────────────────────────────────\\n• **note** — one concise reason, mention key cue and product coverage.\\n Example: `\\\"Model holds bag; product 75 %, bright light\\\"`.\\n\\n• **confidence** — float 0.00 – 1.00 (≤ 3 decimals).\\n 0.90–1.00 very sure (auto-approve)\\n 0.70–0.89 medium (quick spot-check)\\n 0.50–0.69 low (full review)\\n < 0.50 unreliable (relabel likely)\\n\\n──────────────────────────────────────────────────────────────\\n4 · JSON OUTPUT TEMPLATE — COPY & FILL\\n──────────────────────────────────────────────────────────────\\n{\\n \\\"brand\\\": \\\"JW PEI\\\",\\n \\\"categoryName\\\": \\\"<e.g. Influencer Model>\\\",\\n \\\"categoryCode\\\": \\\"<e.g. WHMT>\\\",\\n \\\"confidence\\\": 0.87,\\n \\\"note\\\": \\\"Model holds bag; product 75 %, bright light\\\",\\n \\\"containsCompetitorLogo\\\": false,\\n \\\"containsNonVegFood\\\": false,\\n \\\"faceOccluded\\\": false,\\n \\\"peopleCount\\\": 1,\\n \\\"displayCoveragePercent\\\": 75,\\n \\\"lightingCondition\\\": \\\"good\\\",\\n \\\"backgroundClutterLevel\\\": \\\"low\\\",\\n \\\"containsInfant\\\": false,\\n \\\"containsPregnantPerson\\\": false,\\n \\\"containsVulgarContent\\\": false,\\n \\\"isBlackWhiteFilter\\\": false,\\n \\\"modelGender\\\": \\\"female\\\"\\n}\\n\\n──────────────────────────────────────────────────────────────\\n5 · QUICK REMINDERS\\n──────────────────────────────────────────────────────────────\\n• Unsure between WHJW and LBKP? Check the background: studio backdrop → LBKP.\\n• A torso-only crop with no head still counts as WHMT (model present).\\n• A tiny steak next to the bag flips `containsNonVegFood = true`.\\n• If *any* tile in a collage is AI-generated, label the whole image AIGC.\\n• When the category is **not** WHMT, always leave `\\\"modelGender\\\": \\\"unknown\\\"`.\\n──────────────────────────────────────────────────────────────\"}]"
      }
    ],
    "temperature": 0.2,
    "max_tokens": 1000,
    "stream": false
  }
}
响应示例
{
  "data": {
    "OpenRouterCreateCompletionsForMaterial": {
      "choices": [
        {
          "index": 0,
          "finish_reason": "stop",
          "message": {
            "role": "assistant",
            "content": "{\n \"brand\": \"JW PEI\",\n \"categoryName\": \"Influencer Model\",\n \"categoryCode\": \"WHMT\",\n \"confidence\": 0.78,\n \"note\": \"Person holds JW PEI bag; product ~40% of frame, natural light\",\n \"containsCompetitorLogo\": false,\n \"containsNonVegFood\": false,\n \"faceOccluded\": false,\n \"peopleCount\": 1,\n \"displayCoveragePercent\": 40,\n \"lightingCondition\": \"good\",\n \"backgroundClutterLevel\": \"medium\",\n \"containsInfant\": false,\n \"containsPregnantPerson\": false,\n \"containsVulgarContent\": false,\n \"isBlackWhiteFilter\": false,\n \"modelGender\": \"female\"\n}"
          }
        }
      ],
      "usage": {
        "total_tokens": 2095,
        "prompt_tokens": 1428,
        "completion_tokens": 667
      }
    }
  }
}