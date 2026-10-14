import json
from pathlib import Path
import os
from io import BytesIO
import asyncio
from dotenv import load_dotenv
from fastapi import UploadFile, File
from google import genai
from google.genai import types

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is missing from backend/.env")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI(
    title="Earthy API",
    description="Backend for Earth's personalized nutrition platform.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Reuse the existing frontend dataset.
BASE_DIR = Path(__file__).resolve().parent
FOODS_FILE = BASE_DIR / "data" / "foods.json"

with open(FOODS_FILE, "r", encoding="utf-8") as file:
    FOODS = json.load(file)

FOODS_BY_ID = {food["id"]: food for food in FOODS}


@app.get("/")
def home():
    return {
        "message": "Welcome to Earthy API!",
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/foods")
def get_foods():
    """Return all foods in the dataset."""
    return FOODS


@app.get("/foods/{food_id}")
def get_food(food_id: str):
    """Return a single food by its ID."""
    food = FOODS_BY_ID.get(food_id)

    if food is None:
        raise HTTPException(
            status_code=404,
            detail=f"Food '{food_id}' not found",
        )

    return food


class MealIngredient(BaseModel):
    food_id: str
    grams: float = Field(gt=0)


class NutritionRequest(BaseModel):
    ingredients: list[MealIngredient] = Field(min_length=1)


@app.post("/nutrition/calculate")
def calculate_nutrition(request: NutritionRequest):
    """Calculate meal nutrients from food IDs and quantities in grams."""
    totals = {
        "energy_kcal": 0.0,
        "protein_g": 0.0,
        "iron_mg": 0.0,
        "calcium_mg": 0.0,
        "fibre_g": 0.0,
    }
    breakdown = []

    for ingredient in request.ingredients:
        food = FOODS_BY_ID.get(ingredient.food_id)

        if food is None:
            raise HTTPException(
                status_code=404,
                detail=f"Food '{ingredient.food_id}' not found",
            )

        nutrients = food["nutrients"]
        factor = ingredient.grams / 100

        item_totals = {
            nutrient: round(value * factor, 2)
            for nutrient, value in nutrients.items()
        }

        for nutrient, value in nutrients.items():
            totals[nutrient] += value * factor

        breakdown.append({
            "food_id": food["id"],
            "name": food["name"],
            "grams": ingredient.grams,
            "nutrients": item_totals,
        })

    return {
        "ingredients": breakdown,
        "totals": {
            nutrient: round(value, 2)
            for nutrient, value in totals.items()
        },
    }

@app.post("/meals/analyze-photo")
async def analyze_meal_photo(photo: UploadFile = File(...)):
    """Identify foods and estimate portion sizes from a meal photo."""

    if not photo.content_type or not photo.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Please upload an image file.",
        )

    image_bytes = await photo.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty.",
        )

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Image must be 10 MB or smaller.",
        )

    prompt = """
    Analyze this meal photo for a nutrition-tracking website.

    Identify each visible food and estimate its edible portion in grams.
    Be honest about uncertainty: a photo cannot reliably reveal exact
    weight or hidden ingredients.

    Return only valid JSON in this exact structure:
    {
      "foods": [
        {
          "name": "common food name",
          "estimated_grams": 100,
          "confidence": "low"
        }
      ],
      "needs_user_verification": true
    }

    Use confidence values "low", "medium", or "high".
    If no food is identifiable, return an empty foods array.
    Do not calculate calories or nutrients.
    """

    try:
        
        response = None

        for attempt in range(3):
            try:
                response = gemini_client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=[
                        types.Part.from_bytes(
                            data=image_bytes,
                            mime_type=photo.content_type,
                        ),
                        prompt,
                    ],
                    config={
                        "response_mime_type": "application/json",
                    },
                )
                break
            except Exception as error:
                if attempt == 2:
                    raise
                await asyncio.sleep(2 ** (attempt + 1))


        result = json.loads(response.text)

        if not isinstance(result.get("foods"), list):
            raise ValueError("Gemini returned an invalid foods list.")

        return result

    except HTTPException:
        raise

    except Exception as error:
        print(f"Gemini error: {type(error).__name__}: {error}")
        raise HTTPException(
            status_code=503,
            detail="Food recognition is temporarily unavailable. Please try again in a minute.",
        ) from error
