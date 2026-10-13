"use client";

import { useEffect, useRef, useState } from "react";
import foodsData from "../../data/foods.json";

type Ingredient = {
  foodId: string;
  grams: number;
};

type DetectedFood = {
  name: string;
  estimated_grams: number;
  confidence: "low" | "medium" | "high";
  foodId: string;
};

const nutrientLabels = [
  { key: "energy_kcal", label: "Calories", unit: "kcal" },
  { key: "protein_g", label: "Protein", unit: "g" },
  { key: "iron_mg", label: "Iron", unit: "mg" },
  { key: "calcium_mg", label: "Calcium", unit: "mg" },
  { key: "fibre_g", label: "Fibre", unit: "g" },
] as const;

const foodAliases: Record<string, string[]> = {
  roti: ["roti", "chapati", "chapatti"],
  dal: ["dal", "lentils", "dahl"],
  rice: ["rice", "cooked white rice"],
  egg: ["egg", "boiled egg"],
  milk: ["milk"],
  banana: ["banana"],
  potato: ["potato", "boiled potato"],
  curd: ["curd", "yogurt", "yoghurt"],
};

type NutritionResult = {
  totals: {
    energy_kcal: number;
    protein_g: number;
    iron_mg: number;
    calcium_mg: number;
    fibre_g: number;
  };
  canCalculate: boolean;
};
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const emptyNutrition: NutritionResult = {
  totals: {
    energy_kcal: 0,
    protein_g: 0,
    iron_mg: 0,
    calcium_mg: 0,
    fibre_g: 0,
  },
  canCalculate: false,
};

export default function LogMealPage() {
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [mealType, setMealType] = useState("Lunch");
  const [food, setFood] = useState("");
  const [portion, setPortion] = useState("1 serving");
  const [preparation, setPreparation] = useState("Home-cooked");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const [photoPreview, setPhotoPreview] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const [photoAnalysisError, setPhotoAnalysisError] = useState("");
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);

  const [selectedFoodId, setSelectedFoodId] = useState("roti");
  const [ingredientGrams, setIngredientGrams] = useState("100");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientError, setIngredientError] = useState("");

  const [nutrition, setNutrition] =
    useState<NutritionResult>(emptyNutrition);

  const [nutritionLoading, setNutritionLoading] = useState(false);
  const [nutritionError, setNutritionError] = useState("");

  useEffect(() => {
    if (ingredients.length === 0) {
      setNutrition(emptyNutrition);
      setNutritionError("");
      setNutritionLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchNutrition() {
      setNutritionLoading(true);
      setNutritionError("");

      try {
        const response = await fetch(
          `${API_BASE_URL}/nutrition/calculate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ingredients: ingredients.map((item) => ({
                food_id: item.foodId,
                grams: item.grams,
              })),
            }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Nutrition API returned status ${response.status}`
          );
        }

        const data = await response.json();

        setNutrition({
          totals: data.totals,
          canCalculate: true,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          return;
        }

        setNutrition(emptyNutrition);
        setNutritionError(
          "Unable to calculate nutrition. Check that the Earthy backend is running."
        );
      } finally {
        if (!controller.signal.aborted) {
          setNutritionLoading(false);
        }
      }
    }

    fetchNutrition();

    return () => controller.abort();
  }, [ingredients]);

  function handlePhotoChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhotoError("Please select a valid image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setPhotoError("Please choose an image smaller than 8 MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPhotoPreview(reader.result);
        setPhotoName(file.name);
        setPhotoFile(file);
        setPhotoError("");
        setPhotoAnalysisError("");
        setDetectedFoods([]);
        setSaved(false);
      }
    };

    reader.onerror = () => {
      setPhotoError(
        "Unable to read this image. Please try another."
      );
    };

    reader.readAsDataURL(file);
  }

  function removePhoto() {
    setPhotoPreview("");
    setPhotoName("");
    setPhotoFile(null);
    setPhotoError("");
    setPhotoAnalysisError("");
    setDetectedFoods([]);
    setSaved(false);

    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  }

  async function analyzePhoto() {
    if (!photoFile) {
      setPhotoAnalysisError("Please upload a photo first.");
      return;
    }

    setPhotoAnalyzing(true);
    setPhotoAnalysisError("");
    setDetectedFoods([]);

    try {
      const formData = new FormData();
      formData.append("photo", photoFile);

      const response = await fetch(
        `${API_BASE_URL}/meals/analyze-photo`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Unable to analyze this photo."
        );
      }

      if (!Array.isArray(data.foods)) {
        throw new Error("The AI returned an invalid food list.");
      }

      const results: DetectedFood[] = data.foods.map(
        (item: {
          name: string;
          estimated_grams: number;
          confidence: string;
        }) => {
          const name = String(item.name || "").trim();
          const normalizedName = name.toLowerCase();

          // Match recognized foods using known names and aliases.
          // Unmatched foods must be selected manually.
          const match = foodsData.find((knownFood) => {
            const terms = [
              knownFood.name.toLowerCase(),
              ...(foodAliases[knownFood.id] ?? []),
            ];

            return terms.some((term) => {
              const normalizedTerm = term.toLowerCase();

              return (
                normalizedName === normalizedTerm ||
                normalizedName.includes(normalizedTerm)
              );
            });
          });

          const grams = Number(item.estimated_grams);

          return {
            name: name || "Unknown food",
            estimated_grams:
              Number.isFinite(grams) && grams > 0 ? grams : 100,
            confidence: ["low", "medium", "high"].includes(
              item.confidence
            )
              ? (item.confidence as DetectedFood["confidence"])
              : "low",
            foodId: match?.id ?? "",
          };
        }
      );

      setDetectedFoods(results);
    } catch (error) {
      setPhotoAnalysisError(
        error instanceof Error
          ? error.message
          : "Photo analysis failed. Please try again."
      );
    } finally {
      setPhotoAnalyzing(false);
    }
  }

  function addIngredient() {
    const grams = Number(ingredientGrams);

    const selectedFood = foodsData.find(
      (item) => item.id === selectedFoodId
    );

    if (
      !selectedFood ||
      !Number.isFinite(grams) ||
      grams <= 0
    ) {
      setIngredientError(
        "Enter a valid quantity greater than 0 grams."
      );
      return;
    }

    setIngredients((current) => [
      ...current,
      { foodId: selectedFoodId, grams },
    ]);

    setIngredientError("");
    setSaved(false);
  }

  function removeIngredient(indexToRemove: number) {
    setIngredients((current) =>
      current.filter((_, index) => index !== indexToRemove)
    );

    setSaved(false);
  }

  function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const ingredientSummary = ingredients
      .map((ingredient) => {
        const item = foodsData.find(
          (entry) => entry.id === ingredient.foodId
        );

        return item
          ? `${ingredient.grams} g ${item.name}`
          : "";
      })
      .filter(Boolean)
      .join(", ");

    const newMeal = {
      id: crypto.randomUUID(),
      mealType,
      food:
        food.trim() ||
        ingredientSummary ||
        (photoName ? `Photo meal: ${photoName}` : ""),
      portion: portion.trim(),
      preparation,
      notes: notes.trim(),
      date: new Date().toISOString(),
      ingredients,
      photoName: photoName || null,
      nutrition: ingredients.length > 0 ? nutrition : null,
    };

    try {
      const existingMeals = JSON.parse(
        localStorage.getItem("earthy-meals") || "[]"
      );

      if (!Array.isArray(existingMeals)) {
        throw new Error("Invalid saved meal data");
      }

      localStorage.setItem(
        "earthy-meals",
        JSON.stringify([...existingMeals, newMeal])
      );

      setSaved(true);
      setFood("");
      setPortion("1 serving");
      setNotes("");
      setIngredients([]);
      setIngredientError("");

      // Reset photo and AI state after saving.
      setPhotoPreview("");
      setPhotoName("");
      setPhotoFile(null);
      setPhotoError("");
      setPhotoAnalysisError("");
      setDetectedFoods([]);

      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    } catch {
      setSaved(false);
      setIngredientError(
        "Unable to save this meal. Please check your browser storage and try again."
      );
    }
  }

  return (
    <main className="profile-page">
      <nav className="navbar">
        <a className="brand" href="/">
          <span className="brand-icon">e.</span>
          earthy
        </a>

        <a className="text-button" href="/dashboard">
          ← Dashboard
        </a>
      </nav>

      <section className="profile-container">
        <div className="eyebrow">
          <span className="status-dot" />
          YOUR DAILY FOOD JOURNAL
        </div>

        <h1>
          What have you <span>eaten?</span>
        </h1>

        <p className="profile-intro">
          Every meal tells a story about your nutrition.
          Share what was on your plate and let&apos;s understand
          it together.
        </p>

        <form className="profile-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="mealType">Which meal is this?</label>

            <select
              id="mealType"
              value={mealType}
              onChange={(event) => {
                setMealType(event.target.value);
                setSaved(false);
              }}
            >
              <option>Breakfast</option>
              <option>Lunch</option>
              <option>Dinner</option>
              <option>Snack</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="mealPhoto">Start with a photo</label>

            <p className="field-hint">
              Upload a picture of your meal, or describe it below.
            </p>

            <label
              htmlFor="mealPhoto"
              className="secondary-button"
              style={{
                display: "inline-block",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              {photoPreview
                ? "Choose another photo"
                : "↑ Upload food photo"}
            </label>

            <input
              ref={photoInputRef}
              id="mealPhoto"
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            />

            {photoError && (
              <p className="error-message" role="alert">
                {photoError}
              </p>
            )}

            {photoPreview && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  border: "1px solid #dce3d6",
                  borderRadius: 14,
                }}
              >
                <img
                  src={photoPreview}
                  alt="Preview of your uploaded meal"
                  style={{
                    display: "block",
                    width: "100%",
                    maxHeight: 280,
                    objectFit: "contain",
                    borderRadius: 10,
                    background: "#f5f3ec",
                  }}
                />

                <p className="field-hint">{photoName}</p>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={analyzePhoto}
                  disabled={photoAnalyzing}
                >
                  {photoAnalyzing
                    ? "Analyzing your meal..."
                    : "Analyze meal with AI"}
                </button>

                {photoAnalysisError && (
                  <p className="error-message" role="alert">
                    {photoAnalysisError}
                  </p>
                )}

                {detectedFoods.length > 0 && (
                  <div className="ingredient-list">
                    <h3>AI suggestions — verify before adding</h3>

                    <p className="field-hint">
                      Food recognition and portion sizes are estimates.
                      Correct the food and quantity before confirming.
                    </p>

                    {detectedFoods.map((item, index) => (
                      <div
                        className="ingredient-item"
                        key={`${item.name}-${index}`}
                        style={{
                          display: "block",
                          padding: 12,
                          marginBottom: 12,
                          border: "1px solid #dce3d6",
                          borderRadius: 12,
                        }}
                      >
                        <p>
                          <strong>{item.name}</strong>
                          {" · "}
                          {item.confidence} confidence
                        </p>

                        <label htmlFor={`detected-food-${index}`}>
                          Match to a food in Earthy
                        </label>

                        <select
                          id={`detected-food-${index}`}
                          value={item.foodId}
                          onChange={(event) => {
                            const foodId = event.target.value;

                            setDetectedFoods((current) =>
                              current.map((detected, i) =>
                                i === index
                                  ? { ...detected, foodId }
                                  : detected
                              )
                            );
                          }}
                        >
                          <option value="">
                            Choose the correct food
                          </option>

                          {foodsData.map((knownFood) => (
                            <option
                              key={knownFood.id}
                              value={knownFood.id}
                            >
                              {knownFood.name}
                            </option>
                          ))}
                        </select>

                        <label htmlFor={`detected-grams-${index}`}>
                          Estimated quantity (grams)
                        </label>

                        <input
                          id={`detected-grams-${index}`}
                          type="number"
                          min="1"
                          step="1"
                          value={item.estimated_grams}
                          onChange={(event) => {
                            const grams = Number(event.target.value);

                            setDetectedFoods((current) =>
                              current.map((detected, i) =>
                                i === index
                                  ? {
                                      ...detected,
                                      estimated_grams: grams,
                                    }
                                  : detected
                              )
                            );
                          }}
                        />

                        <button
                          type="button"
                          className="secondary-button"
                          disabled={
                            !item.foodId ||
                            !Number.isFinite(item.estimated_grams) ||
                            item.estimated_grams <= 0
                          }
                          onClick={() => {
                            setIngredients((current) => [
                              ...current,
                              {
                                foodId: item.foodId,
                                grams: item.estimated_grams,
                              },
                            ]);

                            setIngredientError("");
                            setSaved(false);

                            setDetectedFoods((current) =>
                              current.filter((_, i) => i !== index)
                            );
                          }}
                        >
                          + Confirm and add food
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="text-button"
                  onClick={removePhoto}
                >
                  Remove photo
                </button>
              </div>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="food">Describe your meal</label>

            <textarea
              id="food"
              value={food}
              onChange={(event) => {
                setFood(event.target.value);
                setSaved(false);
              }}
              placeholder="e.g. 2 rotis, one bowl of dal, aloo sabzi..."
              rows={4}
              required={ingredients.length === 0 && !photoPreview}
            />

            <span className="field-hint">
              Describe your meal, upload a photo, or add foods individually.
            </span>
          </div>

          <div className="form-field">
            <label>Review and confirm your foods</label>

            <p className="field-hint">
              Add every food you ate and confirm its quantity.
              Nutrition estimates use these confirmed entries.
            </p>

            <label htmlFor="selectedFood">Food item</label>

            <select
              id="selectedFood"
              value={selectedFoodId}
              onChange={(event) =>
                setSelectedFoodId(event.target.value)
              }
            >
              {foodsData.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>

            <label htmlFor="ingredientGrams">Quantity (grams)</label>

            <input
              id="ingredientGrams"
              type="number"
              min="1"
              step="1"
              value={ingredientGrams}
              onChange={(event) =>
                setIngredientGrams(event.target.value)
              }
              required
            />

            <button
              className="secondary-button"
              type="button"
              onClick={addIngredient}
            >
              + Add confirmed food
            </button>

            {ingredientError && (
              <p className="error-message" role="alert">
                {ingredientError}
              </p>
            )}

            {ingredients.length > 0 && (
              <div className="ingredient-list">
                <h3>Confirmed foods</h3>

                {ingredients.map((ingredient, index) => {
                  const item = foodsData.find(
                    (entry) => entry.id === ingredient.foodId
                  );

                  return (
                    <div
                      className="ingredient-item"
                      key={`${ingredient.foodId}-${index}`}
                    >
                      <span>
                        {item?.name ?? ingredient.foodId}
                        {" — "}
                        {ingredient.grams} g
                      </span>

                      <button
                        type="button"
                        className="text-button"
                        onClick={() => removeIngredient(index)}
                        aria-label={`Remove ${item?.name ?? "food"}`}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {ingredients.length > 0 && (
              <div className="nutrition-preview">
                <h3>Nutrition estimate</h3>

                {nutritionLoading ? (
                  <p className="field-hint" role="status">
                    Calculating nutrition...
                  </p>
                ) : nutritionError ? (
                  <p className="error-message" role="alert">
                    {nutritionError}
                  </p>
                ) : nutrition.canCalculate ? (
                  <>
                    <p className="field-hint">
                      Estimated totals for the confirmed foods
                      and quantities you entered.
                    </p>

                    <div className="nutrition-grid">
                      {nutrientLabels.map((nutrient) => (
                        <div
                          className="nutrition-item"
                          key={nutrient.key}
                        >
                          <span>{nutrient.label}</span>

                          <strong>
                            {nutrition.totals[nutrient.key]}{" "}
                            {nutrient.unit}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="field-hint">
                    Nutrition totals are not available yet.
                  </p>
                )}
              </div>
            )}

            <p className="field-hint">
              You can add the same food more than once if needed.
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="portion">
              Serving description (optional)
            </label>

            <input
              id="portion"
              value={portion}
              onChange={(event) => {
                setPortion(event.target.value);
                setSaved(false);
              }}
              placeholder="e.g. 2 rotis, 1 bowl of dal"
            />
          </div>

          <div className="form-field">
            <label htmlFor="preparation">How was it prepared?</label>

            <select
              id="preparation"
              value={preparation}
              onChange={(event) => {
                setPreparation(event.target.value);
                setSaved(false);
              }}
            >
              <option>Home-cooked</option>
              <option>Restaurant / takeaway</option>
              <option>Packaged / ready-to-eat</option>
              <option>Raw / uncooked</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="notes">Anything else? (optional)</label>

            <textarea
              id="notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setSaved(false);
              }}
              placeholder="e.g. cooked with ghee, less oil, extra sugar..."
              rows={2}
            />
          </div>

          <div className="privacy-note">
            <span>✳</span>
            Your meal details are saved in this browser. When you choose
            Analyze meal with AI, the selected photo is sent to Earthy&apos;s
            backend and Google Gemini for food recognition. Only confirmed
            food entries are used for nutrition calculations.
          </div>

          <button
            className="primary-button submit-button"
            type="submit"
          >
            Save meal <span>→</span>
          </button>

          {saved && (
            <p className="success-message" role="status">
              ✓ Meal saved! You can log another meal whenever
              you&apos;re ready.
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
