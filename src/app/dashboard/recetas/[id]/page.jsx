"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { jsPDF } from "jspdf";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

/* =========================================================
   HELPERS
========================================================= */

function getRelatedObject(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function money(value, decimals = 2) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function quantity(value) {
  return Number(value || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  });
}

function getIngredientUnitCost(ingredient) {
  if (!ingredient) return 0;

  const averageCost = Number(ingredient.average_unit_cost);

  if (Number.isFinite(averageCost) && averageCost > 0) {
    return averageCost;
  }

  const purchaseQuantity = Number(ingredient.purchase_quantity) || 0;

  const purchaseCost = Number(ingredient.purchase_cost) || 0;

  if (purchaseQuantity <= 0) {
    return 0;
  }

  return purchaseCost / purchaseQuantity;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeFileName(value) {
  return String(value || "receta")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_");
}

async function imageUrlToDataUrl(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        resolve(reader.result);
      };

      reader.onerror = reject;

      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* =========================================================
   CARGAR DATOS
========================================================= */

async function getRecipeDetail(recipeId) {
  const [
    configResult,
    recipeResult,
    ingredientsResult,
    subrecipesResult,
    stepsResult,
    inventoryResult,
    categoriesResult,
    recipesResult,
  ] = await Promise.all([
    supabase
      .from("app_config")
      .select(
        `
        business_name,
        logo_url,
        kwh_cost,
        electric_power_watts,
        oven_power_watts,
        gas_hourly_cost
      `,
      )
      .order("updated_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("recipes")
      .select(
        `
        id,
        name,
        category_id,

        labor_cost,

        electric_time_minutes,
        gas_time_minutes,

        yield_quantity,
        yield_unit,

        cost_percentage,
        waste_percentage,

        created_at,
        updated_at,

        categories (
          id,
          name,
          description
        )
      `,
      )
      .eq("id", recipeId)
      .single(),

    supabase
      .from("recipe_ingredients")
      .select(
        `
        id,
        ingredient_id,
        quantity_needed,

        ingredients (
          id,
          name,
          unit,
          purchase_quantity,
          purchase_cost,
          average_unit_cost,
          current_stock,
          minimum_stock,
          is_active
        )
      `,
      )
      .eq("recipe_id", recipeId)
      .order("id"),

    supabase
      .from("recipe_subrecipes")
      .select(
        `
        id,
        subrecipe_id,
        quantity_needed,

        subrecipe:recipes!recipe_subrecipes_subrecipe_fk (
          id,
          name,
          yield_quantity,
          yield_unit
        )
      `,
      )
      .eq("recipe_id", recipeId)
      .order("id"),

    supabase
      .from("recipe_steps")
      .select(
        `
        id,
        step_number,
        description
      `,
      )
      .eq("recipe_id", recipeId)
      .order("step_number", {
        ascending: true,
      }),

    supabase
      .from("ingredients")
      .select(
        `
        id,
        name,
        unit,
        purchase_quantity,
        purchase_cost,
        average_unit_cost,
        current_stock,
        minimum_stock,
        is_active
      `,
      )
      .eq("is_active", true)
      .order("name"),

    supabase
      .from("categories")
      .select(
        `
        id,
        name,
        description
      `,
      )
      .order("name"),

    supabase
      .from("recipes")
      .select(
        `
        id,
        name,
        yield_quantity,
        yield_unit
      `,
      )
      .neq("id", recipeId)
      .order("name"),
  ]);

  if (configResult.error) throw configResult.error;
  if (recipeResult.error) throw recipeResult.error;
  if (ingredientsResult.error) throw ingredientsResult.error;
  if (subrecipesResult.error) throw subrecipesResult.error;
  if (stepsResult.error) throw stepsResult.error;
  if (inventoryResult.error) throw inventoryResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (recipesResult.error) throw recipesResult.error;

  const { data: breakdown, error: breakdownError } = await supabase.rpc(
    "get_recipe_cost_breakdown",
    {
      p_recipe_id: recipeId,
    },
  );

  if (breakdownError) {
    throw breakdownError;
  }

  const availableRecipes = await Promise.all(
    (recipesResult.data ?? []).map(async (recipe) => {
      const { data, error } = await supabase.rpc("get_recipe_cost_breakdown", {
        p_recipe_id: recipe.id,
      });

      if (error) {
        throw error;
      }

      return {
        ...recipe,
        breakdown: data ?? {},
      };
    }),
  );

  const inventoryMap = new Map(
    (inventoryResult.data ?? []).map((ingredient) => [
      ingredient.id,
      ingredient,
    ]),
  );

  /*
    Si la receta contiene un ingrediente que posteriormente
    fue desactivado, lo conservamos visible para poder editarlo.
  */
  (ingredientsResult.data ?? []).forEach((relation) => {
    const ingredient = getRelatedObject(relation.ingredients);

    if (ingredient && !inventoryMap.has(ingredient.id)) {
      inventoryMap.set(ingredient.id, ingredient);
    }
  });

  const inventory = Array.from(inventoryMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );

  return {
    config: configResult.data ?? {
      business_name: "Mi negocio",
      logo_url: "",
      kwh_cost: 0,
      electric_power_watts: 0,
      oven_power_watts: 0,
      gas_hourly_cost: 0,
    },

    recipe: recipeResult.data,

    ingredients: ingredientsResult.data ?? [],

    subrecipes: subrecipesResult.data ?? [],

    steps: stepsResult.data ?? [],

    inventory,

    categories: categoriesResult.data ?? [],

    availableRecipes,

    breakdown: breakdown ?? {},
  };
}

/* =========================================================
   COMPONENTE PRINCIPAL
========================================================= */

export default function DetalleRecetaPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const editRequested = searchParams.get("edit") === "true";

  /* ------------------ Datos ------------------ */

  const [config, setConfig] = useState(null);
  const [recipe, setRecipe] = useState(null);

  const [ingredientRelations, setIngredientRelations] = useState([]);

  const [subrecipeRelations, setSubrecipeRelations] = useState([]);

  const [steps, setSteps] = useState([]);

  const [inventory, setInventory] = useState([]);

  const [categories, setCategories] = useState([]);

  const [availableRecipes, setAvailableRecipes] = useState([]);

  const [breakdown, setBreakdown] = useState(null);

  /* ------------------ Estados UI ------------------ */

  const [loading, setLoading] = useState(true);

  const [isEditing, setIsEditing] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  const [isProducing, setIsProducing] = useState(false);

  const [isExporting, setIsExporting] = useState(false);

  /* ------------------ Draft edición ------------------ */

  const [draftName, setDraftName] = useState("");

  const [draftCategoryId, setDraftCategoryId] = useState("");

  const [draftYieldQuantity, setDraftYieldQuantity] = useState("1");

  const [draftYieldUnit, setDraftYieldUnit] = useState("pz");

  const [draftElectricTime, setDraftElectricTime] = useState("0");

  const [draftGasTime, setDraftGasTime] = useState("0");

  const [draftLaborCost, setDraftLaborCost] = useState("0");

  const [draftCostPercentage, setDraftCostPercentage] = useState("35");

  const [draftWastePercentage, setDraftWastePercentage] = useState("10");

  const [draftIngredients, setDraftIngredients] = useState([]);

  const [draftSubrecipes, setDraftSubrecipes] = useState([]);

  const [draftSteps, setDraftSteps] = useState([]);

  /* =====================================================
     CARGA INICIAL
  ===================================================== */

  useEffect(() => {
    if (!id) return;

    let active = true;

    async function loadRecipe() {
      try {
        const data = await getRecipeDetail(id);

        if (!active) return;

        setConfig(data.config);
        setRecipe(data.recipe);

        setIngredientRelations(data.ingredients);

        setSubrecipeRelations(data.subrecipes);

        setSteps(data.steps);

        setInventory(data.inventory);

        setCategories(data.categories);

        setAvailableRecipes(data.availableRecipes);

        setBreakdown(data.breakdown);

        if (editRequested) {
          setDraftName(data.recipe.name ?? "");

          setDraftCategoryId(data.recipe.category_id ?? "");

          setDraftYieldQuantity(String(data.recipe.yield_quantity ?? 1));

          setDraftYieldUnit(data.recipe.yield_unit ?? "pz");

          setDraftElectricTime(String(data.recipe.electric_time_minutes ?? 0));

          setDraftGasTime(String(data.recipe.gas_time_minutes ?? 0));

          setDraftLaborCost(String(data.recipe.labor_cost ?? 0));

          setDraftCostPercentage(String(data.recipe.cost_percentage ?? 35));

          setDraftWastePercentage(String(data.recipe.waste_percentage ?? 10));

          setDraftIngredients(
            data.ingredients.map((relation) => ({
              ingredientId: relation.ingredient_id,

              quantityNeeded: String(relation.quantity_needed ?? ""),
            })),
          );

          setDraftSubrecipes(
            data.subrecipes.map((relation) => ({
              subrecipeId: relation.subrecipe_id,

              quantityNeeded: String(relation.quantity_needed ?? ""),
            })),
          );

          setDraftSteps(
            data.steps.length > 0
              ? data.steps.map((step) => ({
                  description: step.description ?? "",
                }))
              : [
                  {
                    description: "",
                  },
                ],
          );

          setIsEditing(true);
        }
      } catch (error) {
        console.error("Error cargando receta:", error);

        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo cargar la receta",
            text: error?.message || "Ocurrió un error.",
            confirmButtonColor: "#8b5e3c",
          });

          router.replace("/dashboard/recetas");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadRecipe();

    return () => {
      active = false;
    };
  }, [id, router, editRequested]);

  /* =====================================================
     REFRESH
  ===================================================== */

  const refreshRecipe = async () => {
    const data = await getRecipeDetail(id);

    setConfig(data.config);
    setRecipe(data.recipe);

    setIngredientRelations(data.ingredients);

    setSubrecipeRelations(data.subrecipes);

    setSteps(data.steps);

    setInventory(data.inventory);

    setCategories(data.categories);

    setAvailableRecipes(data.availableRecipes);

    setBreakdown(data.breakdown);

    return data;
  };

  /* =====================================================
     CÁLCULO EN MODO EDICIÓN
  ===================================================== */

  const draftCalculations = useMemo(() => {
    const directIngredientCost = draftIngredients.reduce((total, row) => {
      const ingredient = inventory.find((item) => item.id === row.ingredientId);

      const amount = Number(row.quantityNeeded) || 0;

      return total + getIngredientUnitCost(ingredient) * amount;
    }, 0);

    const subrecipeCost = draftSubrecipes.reduce((total, row) => {
      const selectedRecipe = availableRecipes.find(
        (item) => item.id === row.subrecipeId,
      );

      const unitCost = Number(selectedRecipe?.breakdown?.cost_per_unit) || 0;

      const amount = Number(row.quantityNeeded) || 0;

      return total + unitCost * amount;
    }, 0);

    const electricPower =
      Number(config?.electric_power_watts) ||
      Number(config?.oven_power_watts) ||
      0;

    const electricCost =
      (electricPower / 1000) *
      (Number(draftElectricTime || 0) / 60) *
      Number(config?.kwh_cost || 0);

    const gasCost =
      (Number(draftGasTime || 0) / 60) * Number(config?.gas_hourly_cost || 0);

    const laborCost = Number(draftLaborCost || 0);

    const totalCost =
      directIngredientCost + subrecipeCost + electricCost + gasCost + laborCost;

    const yieldAmount = Number(draftYieldQuantity) || 0;

    const costPerUnit = yieldAmount > 0 ? totalCost / yieldAmount : 0;

    const costPercentage = Number(draftCostPercentage) || 0;

    const subtotalSalePerUnit =
      costPercentage > 0 ? costPerUnit / (costPercentage / 100) : 0;

    const wastePercentage = Number(draftWastePercentage) || 0;

    const wastePerUnit = subtotalSalePerUnit * (wastePercentage / 100);

    const finalPricePerUnit = subtotalSalePerUnit + wastePerUnit;

    /*
        Ganancia final después de considerar
        el costo real y la reserva de merma.
      */
    const profitPerUnit = subtotalSalePerUnit - costPerUnit;

    const finalPriceBatch = finalPricePerUnit * yieldAmount;

    return {
      direct_ingredient_cost: directIngredientCost,

      subrecipe_cost: subrecipeCost,

      electric_cost: electricCost,

      gas_cost: gasCost,

      labor_cost: laborCost,

      total_cost: totalCost,

      yield_quantity: yieldAmount,

      yield_unit: draftYieldUnit,

      cost_per_unit: costPerUnit,

      cost_percentage: costPercentage,

      subtotal_sale_per_unit: subtotalSalePerUnit,

      waste_percentage: wastePercentage,

      waste_per_unit: wastePerUnit,

      profit_per_unit: profitPerUnit,

      final_price_per_unit: finalPricePerUnit,

      final_price_batch: finalPriceBatch,
    };
  }, [
    availableRecipes,
    config,
    draftCostPercentage,
    draftElectricTime,
    draftGasTime,
    draftIngredients,
    draftLaborCost,
    draftSubrecipes,
    draftWastePercentage,
    draftYieldQuantity,
    draftYieldUnit,
    inventory,
  ]);

  /* =====================================================
     INICIAR / CANCELAR EDICIÓN
  ===================================================== */

  const startEditing = () => {
    if (!recipe) return;

    setDraftName(recipe.name ?? "");

    setDraftCategoryId(recipe.category_id ?? "");

    setDraftYieldQuantity(String(recipe.yield_quantity ?? 1));

    setDraftYieldUnit(recipe.yield_unit ?? "pz");

    setDraftElectricTime(String(recipe.electric_time_minutes ?? 0));

    setDraftGasTime(String(recipe.gas_time_minutes ?? 0));

    setDraftLaborCost(String(recipe.labor_cost ?? 0));

    setDraftCostPercentage(String(recipe.cost_percentage ?? 35));

    setDraftWastePercentage(String(recipe.waste_percentage ?? 10));

    setDraftIngredients(
      ingredientRelations.map((relation) => ({
        ingredientId: relation.ingredient_id,

        quantityNeeded: String(relation.quantity_needed ?? ""),
      })),
    );

    setDraftSubrecipes(
      subrecipeRelations.map((relation) => ({
        subrecipeId: relation.subrecipe_id,

        quantityNeeded: String(relation.quantity_needed ?? ""),
      })),
    );

    setDraftSteps(
      steps.length > 0
        ? steps.map((step) => ({
            description: step.description ?? "",
          }))
        : [
            {
              description: "",
            },
          ],
    );

    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  /* =====================================================
     INGREDIENTES
  ===================================================== */

  const updateDraftIngredient = (index, field, value) => {
    setDraftIngredients((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row,
      ),
    );
  };

  const addDraftIngredient = () => {
    setDraftIngredients((current) => [
      ...current,
      {
        ingredientId: "",
        quantityNeeded: "",
      },
    ]);
  };

  const removeDraftIngredient = (index) => {
    setDraftIngredients((current) =>
      current.filter((_, rowIndex) => rowIndex !== index),
    );
  };

  /* =====================================================
     SUBRECETAS
  ===================================================== */

  const updateDraftSubrecipe = (index, field, value) => {
    setDraftSubrecipes((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row,
      ),
    );
  };

  const addDraftSubrecipe = () => {
    setDraftSubrecipes((current) => [
      ...current,
      {
        subrecipeId: "",
        quantityNeeded: "",
      },
    ]);
  };

  const removeDraftSubrecipe = (index) => {
    setDraftSubrecipes((current) =>
      current.filter((_, rowIndex) => rowIndex !== index),
    );
  };

  /* =====================================================
     PASOS
  ===================================================== */

  const updateDraftStep = (index, value) => {
    setDraftSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index
          ? {
              description: value,
            }
          : step,
      ),
    );
  };

  const addDraftStep = () => {
    setDraftSteps((current) => [
      ...current,
      {
        description: "",
      },
    ]);
  };

  const removeDraftStep = (index) => {
    setDraftSteps((current) => {
      const next = current.filter((_, stepIndex) => stepIndex !== index);

      return next.length > 0
        ? next
        : [
            {
              description: "",
            },
          ];
    });
  };

  const moveDraftStep = (index, direction) => {
    setDraftSteps((current) => {
      const destination = index + direction;

      if (destination < 0 || destination >= current.length) {
        return current;
      }

      const copy = [...current];

      [copy[index], copy[destination]] = [copy[destination], copy[index]];

      return copy;
    });
  };

  /* =====================================================
     VALIDACIÓN EDICIÓN
  ===================================================== */

  const validateDraft = async () => {
    if (!draftName.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre de la receta.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    if (!draftCategoryId) {
      await Swal.fire({
        icon: "warning",
        title: "Categoría requerida",
        text: "Selecciona una categoría.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const yieldAmount = Number(draftYieldQuantity);

    if (!Number.isFinite(yieldAmount) || yieldAmount <= 0) {
      await Swal.fire({
        icon: "warning",
        title: "Rendimiento inválido",
        text: "El rendimiento debe ser mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const electricTime = Number(draftElectricTime || 0);

    const gasTime = Number(draftGasTime || 0);

    const labor = Number(draftLaborCost || 0);

    if (!Number.isFinite(electricTime) || electricTime < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Tiempo eléctrico inválido",
        text: "Los minutos eléctricos no pueden ser negativos.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    if (!Number.isFinite(gasTime) || gasTime < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Tiempo de gas inválido",
        text: "Los minutos de gas no pueden ser negativos.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    if (!Number.isFinite(labor) || labor < 0) {
      await Swal.fire({
        icon: "warning",
        title: "Mano de obra inválida",
        text: "El costo de mano de obra no puede ser negativo.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const costPercentage = Number(draftCostPercentage);

    if (
      !Number.isFinite(costPercentage) ||
      costPercentage <= 0 ||
      costPercentage > 100
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Porcentaje de costo inválido",
        text: "Debe ser mayor que 0 y máximo 100%.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const wastePercentage = Number(draftWastePercentage);

    if (
      !Number.isFinite(wastePercentage) ||
      wastePercentage < 0 ||
      wastePercentage > 100
    ) {
      await Swal.fire({
        icon: "warning",
        title: "Merma inválida",
        text: "La merma debe estar entre 0 y 100%.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const ingredients = draftIngredients.filter(
      (row) => row.ingredientId || String(row.quantityNeeded).trim(),
    );

    const subrecipes = draftSubrecipes.filter(
      (row) => row.subrecipeId || String(row.quantityNeeded).trim(),
    );

    if (ingredients.length === 0 && subrecipes.length === 0) {
      await Swal.fire({
        icon: "warning",
        title: "Faltan ingredientes",
        text: "La receta debe contener al menos un ingrediente o una receta como ingrediente.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const invalidIngredient = ingredients.find(
      (row) =>
        !row.ingredientId ||
        !Number.isFinite(Number(row.quantityNeeded)) ||
        Number(row.quantityNeeded) <= 0,
    );

    if (invalidIngredient) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente incompleto",
        text: "Selecciona cada ingrediente y escribe una cantidad mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const ingredientIds = ingredients.map((row) => row.ingredientId);

    if (new Set(ingredientIds).size !== ingredientIds.length) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente repetido",
        text: "Cada ingrediente solamente puede aparecer una vez.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const invalidSubrecipe = subrecipes.find(
      (row) =>
        !row.subrecipeId ||
        !Number.isFinite(Number(row.quantityNeeded)) ||
        Number(row.quantityNeeded) <= 0,
    );

    if (invalidSubrecipe) {
      await Swal.fire({
        icon: "warning",
        title: "Receta incompleta",
        text: "Selecciona cada receta y la cantidad que se utilizará.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const subrecipeIds = subrecipes.map((row) => row.subrecipeId);

    if (new Set(subrecipeIds).size !== subrecipeIds.length) {
      await Swal.fire({
        icon: "warning",
        title: "Receta repetida",
        text: "Una misma receta solamente puede agregarse una vez.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    return true;
  };

  /* =====================================================
     GUARDAR EDICIÓN
  ===================================================== */

  const handleSaveChanges = async () => {
    const valid = await validateDraft();

    if (!valid) return;

    const confirmation = await Swal.fire({
      icon: "question",
      title: "¿Guardar cambios?",
      text: "Se actualizará toda la receta y su cálculo de costos.",
      showCancelButton: true,
      confirmButtonText: "Sí, guardar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    const ingredientsPayload = draftIngredients
      .filter((row) => row.ingredientId)
      .map((row) => ({
        ingredient_id: row.ingredientId,

        quantity_needed: Number(row.quantityNeeded),
      }));

    const subrecipesPayload = draftSubrecipes
      .filter((row) => row.subrecipeId)
      .map((row) => ({
        subrecipe_id: row.subrecipeId,

        quantity_needed: Number(row.quantityNeeded),
      }));

    const stepsPayload = draftSteps
      .map((step) => ({
        description: step.description.trim(),
      }))
      .filter((step) => step.description);

    try {
      setIsSaving(true);

      const { error } = await supabase.rpc("update_recipe_with_details", {
        p_recipe_id: recipe.id,

        p_name: draftName.trim(),

        p_category_id: draftCategoryId,

        p_labor_cost: Number(draftLaborCost || 0),

        p_electric_time_minutes: Math.trunc(Number(draftElectricTime || 0)),

        p_gas_time_minutes: Math.trunc(Number(draftGasTime || 0)),

        p_yield_quantity: Number(draftYieldQuantity),

        p_yield_unit: draftYieldUnit,

        p_cost_percentage: Number(draftCostPercentage),

        p_waste_percentage: Number(draftWastePercentage),

        p_ingredients: ingredientsPayload,

        p_subrecipes: subrecipesPayload,

        p_steps: stepsPayload,
      });

      if (error) {
        throw error;
      }

      await refreshRecipe();

      setIsEditing(false);

      router.replace(`/dashboard/recetas/${recipe.id}`);

      await Swal.fire({
        icon: "success",
        title: "Receta actualizada",
        text: "Los cambios se guardaron correctamente.",
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (error) {
      console.error("Error guardando receta:", error);

      await Swal.fire({
        icon: "error",
        title: "No se pudieron guardar los cambios",
        text: error?.message || "Ocurrió un error.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsSaving(false);
    }
  };

  /* =====================================================
     PRODUCCIÓN
  ===================================================== */

  const handleProduce = async () => {
    const batchResult = await Swal.fire({
      icon: "question",
      title: `Producir ${recipe.name}`,
      text: "Indica cuántos lotes completos vas a preparar.",
      input: "number",
      inputValue: 1,
      inputAttributes: {
        min: "1",
        step: "1",
      },
      showCancelButton: true,
      confirmButtonText: "Continuar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",

      inputValidator: (value) => {
        const batches = Number(value);

        if (!Number.isInteger(batches) || batches <= 0) {
          return "Escribe una cantidad entera mayor que cero.";
        }

        return undefined;
      },
    });

    if (!batchResult.isConfirmed) {
      return;
    }

    const batches = Number(batchResult.value);

    try {
      setIsProducing(true);

      /*
        Esta función ya baja hasta las subrecetas
        y calcula los ingredientes reales necesarios.
      */
      const { data: requirementsData, error: requirementsError } =
        await supabase.rpc("get_recipe_inventory_requirements", {
          p_recipe_id: recipe.id,

          p_batches: batches,
        });

      if (requirementsError) {
        throw requirementsError;
      }

      const requirements = Array.isArray(requirementsData)
        ? requirementsData
        : [];

      const insufficient = requirements.filter((item) => !item.sufficient);

      if (insufficient.length > 0) {
        await Swal.fire({
          icon: "error",
          title: "Inventario insuficiente",

          html: `
            <p style="margin-bottom:12px">
              No puedes producir
              <strong>
                ${batches} lote(s)
              </strong>.
            </p>

            <ul style="
              margin:0;
              padding:0;
              list-style:none;
            ">
              ${insufficient
                .map(
                  (item) => `
                    <li style="
                      padding:10px 0;
                      border-bottom:1px solid #e7e5e4;
                      text-align:left;
                    ">
                      <strong>
                        ${escapeHtml(item.name)}
                      </strong>

                      <br>

                      Necesario:
                      ${quantity(item.required_quantity)}
                      ${escapeHtml(item.unit)}

                      · Disponible:
                      ${quantity(item.current_stock)}
                      ${escapeHtml(item.unit)}
                    </li>
                  `,
                )
                .join("")}
            </ul>
          `,

          confirmButtonColor: "#8b5e3c",
        });

        return;
      }

      const confirmation = await Swal.fire({
        icon: "warning",
        title: "Confirmar producción",

        html: `
            <p>
              Se producirán
              <strong>
                ${quantity(Number(recipe.yield_quantity) * batches)}
                ${escapeHtml(recipe.yield_unit)}
              </strong>.
            </p>

            <p style="margin-top:12px">
              Se descontará del inventario:
            </p>

            <ul style="
              margin:14px 0 0;
              padding:0;
              list-style:none;
            ">
              ${requirements
                .map(
                  (item) => `
                    <li style="
                      display:flex;
                      justify-content:space-between;
                      gap:16px;
                      padding:8px 0;
                      border-bottom:1px solid #e7e5e4;
                    ">
                      <span>
                        ${escapeHtml(item.name)}
                      </span>

                      <strong>
                        ${quantity(item.required_quantity)}
                        ${escapeHtml(item.unit)}
                      </strong>
                    </li>
                  `,
                )
                .join("")}
            </ul>
          `,

        showCancelButton: true,
        confirmButtonText: "Sí, producir",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#8b5e3c",
        cancelButtonColor: "#78716c",
        reverseButtons: true,
      });

      if (!confirmation.isConfirmed) {
        return;
      }

      Swal.fire({
        title: "Registrando producción",
        text: "Descontando ingredientes del inventario...",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading(),
      });

      const { data, error } = await supabase.rpc("produce_recipe", {
        p_recipe_id: recipe.id,

        p_batches: batches,
      });

      if (error) {
        throw error;
      }

      await refreshRecipe();

      const lowStock = Array.isArray(data?.low_stock) ? data.low_stock : [];

      await Swal.fire({
        icon: "success",
        title: "Producción registrada",

        html: `
          <p>
            Producción:
            <strong>
              ${quantity(data?.produced_quantity)}
              ${escapeHtml(data?.yield_unit || recipe.yield_unit)}
            </strong>
          </p>

          <p style="margin-top:10px">
            Costo real:
            <strong>
              ${money(data?.production_cost)}
            </strong>
          </p>

          <p style="margin-top:6px">
            Precio sugerido por
            ${escapeHtml(recipe.yield_unit)}:
            <strong>
              ${money(data?.final_price_per_unit)}
            </strong>
          </p>

          <p style="margin-top:6px">
            Venta total estimada:
            <strong>
              ${money(data?.final_price)}
            </strong>
          </p>

          ${
            lowStock.length > 0
              ? `
                <div style="
                  margin-top:16px;
                  padding:14px;
                  border-radius:12px;
                  background:#fff7ed;
                  text-align:left;
                  color:#9a3412;
                ">
                  <strong>
                    Ingredientes con stock bajo:
                  </strong>

                  <ul style="
                    margin:8px 0 0;
                    padding-left:20px;
                  ">
                    ${lowStock
                      .map(
                        (item) => `
                          <li>
                            ${escapeHtml(item.name)}:
                            ${quantity(item.current_stock)}
                            ${escapeHtml(item.unit)}
                          </li>
                        `,
                      )
                      .join("")}
                  </ul>
                </div>
              `
              : ""
          }
        `,

        confirmButtonColor: "#8b5e3c",
      });
    } catch (error) {
      console.error("Error produciendo:", error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo registrar la producción",
        text: error?.message || "Ocurrió un error.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsProducing(false);
    }
  };

  /* =====================================================
     PDF
  ===================================================== */

  const handleExportPdf = async () => {
    try {
      setIsExporting(true);

      const doc = new jsPDF();

      const pageWidth = doc.internal.pageSize.getWidth();

      const pageHeight = doc.internal.pageSize.getHeight();

      const margin = 18;

      let y = 20;

      function ensureSpace(space = 20) {
        if (y + space > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }
      }

      const businessName = config?.business_name || "Mi negocio";

      const logoData = await imageUrlToDataUrl(config?.logo_url);

      if (logoData) {
        try {
          const format = logoData.startsWith("data:image/jpeg")
            ? "JPEG"
            : "PNG";

          doc.addImage(logoData, format, margin, 12, 22, 22);
        } catch {
          // Si el formato del logo no es compatible,
          // simplemente continuamos sin logo.
        }
      }

      doc.setFont("helvetica", "bold");

      doc.setFontSize(18);

      doc.text(businessName, logoData ? margin + 28 : margin, y);

      y += 10;

      doc.setFontSize(22);

      doc.text(recipe.name, margin, y);

      y += 10;

      doc.setFont("helvetica", "normal");

      doc.setFontSize(10);

      const category = getRelatedObject(recipe.categories);

      doc.text(`Categoría: ${category?.name || "Sin categoría"}`, margin, y);

      y += 6;

      doc.text(
        `Rendimiento: ${quantity(recipe.yield_quantity)} ${recipe.yield_unit}`,
        margin,
        y,
      );

      y += 6;

      doc.text(
        `Electricidad: ${quantity(recipe.electric_time_minutes)} min`,
        margin,
        y,
      );

      y += 6;

      doc.text(`Gas: ${quantity(recipe.gas_time_minutes)} min`, margin, y);

      y += 10;

      /* COSTOS */

      ensureSpace(70);

      doc.setFont("helvetica", "bold");

      doc.setFontSize(14);

      doc.text("Costeo", margin, y);

      y += 8;

      doc.setFontSize(10);

      const costLines = [
        ["Ingredientes", money(breakdown?.direct_ingredient_cost)],

        ["Otras recetas", money(breakdown?.subrecipe_cost)],

        ["Electricidad", money(breakdown?.electric_cost)],

        ["Gas", money(breakdown?.gas_cost)],

        ["Mano de obra", money(breakdown?.labor_cost)],

        ["Costo total del lote", money(breakdown?.total_cost)],

        [`Costo por ${recipe.yield_unit}`, money(breakdown?.cost_per_unit)],

        [
          `Costo objetivo (${quantity(recipe.cost_percentage)}%)`,
          money(breakdown?.cost_per_unit),
        ],

        ["Subtotal de venta", money(breakdown?.subtotal_sale_per_unit)],

        [
          `Merma (${quantity(recipe.waste_percentage)}%)`,
          money(breakdown?.waste_per_unit),
        ],

        [
          `Precio final por ${recipe.yield_unit}`,
          money(breakdown?.final_price_per_unit),
        ],

        ["Venta lote completo", money(breakdown?.final_price_batch)],
      ];

      costLines.forEach(([label, value]) => {
        ensureSpace(7);

        doc.setFont("helvetica", "normal");

        doc.text(label, margin, y);

        doc.setFont("helvetica", "bold");

        doc.text(value, pageWidth - margin, y, {
          align: "right",
        });

        y += 7;
      });

      y += 5;

      /* INGREDIENTES */

      ensureSpace(20);

      doc.setFont("helvetica", "bold");

      doc.setFontSize(14);

      doc.text("Ingredientes", margin, y);

      y += 8;

      doc.setFontSize(10);

      ingredientRelations.forEach((relation) => {
        ensureSpace(8);

        const ingredient = getRelatedObject(relation.ingredients);

        if (!ingredient) {
          return;
        }

        const text =
          `${ingredient.name} — ` +
          `${quantity(relation.quantity_needed)} ${ingredient.unit}`;

        doc.setFont("helvetica", "normal");

        doc.text(text, margin, y);

        const itemCost =
          getIngredientUnitCost(ingredient) *
          Number(relation.quantity_needed || 0);

        doc.text(money(itemCost), pageWidth - margin, y, {
          align: "right",
        });

        y += 7;
      });

      /* SUBRECETAS */

      if (subrecipeRelations.length > 0) {
        y += 5;

        ensureSpace(20);

        doc.setFont("helvetica", "bold");

        doc.setFontSize(14);

        doc.text("Recetas utilizadas como ingrediente", margin, y);

        y += 8;

        doc.setFontSize(10);

        subrecipeRelations.forEach((relation) => {
          ensureSpace(8);

          const subrecipe = getRelatedObject(relation.subrecipe);

          if (!subrecipe) {
            return;
          }

          const option = availableRecipes.find(
            (item) => item.id === relation.subrecipe_id,
          );

          const unitCost = Number(option?.breakdown?.cost_per_unit) || 0;

          const itemCost = unitCost * Number(relation.quantity_needed || 0);

          doc.setFont("helvetica", "normal");

          doc.text(
            `${subrecipe.name} — ${quantity(relation.quantity_needed)} ${
              subrecipe.yield_unit
            }`,
            margin,
            y,
          );

          doc.text(money(itemCost), pageWidth - margin, y, {
            align: "right",
          });

          y += 7;
        });
      }

      /* PREPARACIÓN */

      y += 6;

      ensureSpace(20);

      doc.setFont("helvetica", "bold");

      doc.setFontSize(14);

      doc.text("Preparación", margin, y);

      y += 8;

      doc.setFontSize(10);

      if (steps.length === 0) {
        doc.setFont("helvetica", "normal");

        doc.text("Sin pasos registrados.", margin, y);
      } else {
        steps.forEach((step) => {
          const lines = doc.splitTextToSize(
            `${step.step_number}. ${step.description}`,
            pageWidth - margin * 2,
          );

          ensureSpace(lines.length * 6 + 3);

          doc.setFont("helvetica", "normal");

          doc.text(lines, margin, y);

          y += lines.length * 6 + 3;
        });
      }

      doc.save(`${sanitizeFileName(recipe.name)}.pdf`);
    } catch (error) {
      console.error("Error generando PDF:", error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo generar el PDF",
        text: error?.message || "Ocurrió un error.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsExporting(false);
    }
  };

  /* =====================================================
     LOADING
  ===================================================== */

  if (loading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white py-20 text-center text-stone-500 shadow-sm">
        Cargando receta...
      </div>
    );
  }

  if (!recipe) {
    return null;
  }

  const category = getRelatedObject(recipe.categories);

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => router.push("/dashboard/recetas")}
          className="w-fit text-sm font-bold text-stone-500 transition hover:text-stone-900"
        >
          ← Volver a recetas
        </button>

        <div className="flex flex-wrap gap-2">
          {!isEditing ? (
            <>
              <button
                type="button"
                onClick={startEditing}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-stone-700 transition hover:bg-orange-50"
              >
                Editar receta
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExporting}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
              >
                {isExporting ? "Generando..." : "Descargar PDF"}
              </button>

              <button
                type="button"
                onClick={handleProduce}
                disabled={isProducing}
                className="rounded-xl bg-[#8b5e3c] px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#70472d] disabled:opacity-60"
              >
                {isProducing ? "Produciendo..." : "Producir receta"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={isSaving}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-black text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="rounded-xl bg-[#8b5e3c] px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#70472d] disabled:opacity-60"
              >
                {isSaving ? "Guardando..." : "Guardar cambios"}
              </button>
            </>
          )}
        </div>
      </div>

      {!isEditing ? (
        <RecipeView
          recipe={recipe}
          category={category}
          ingredientRelations={ingredientRelations}
          subrecipeRelations={subrecipeRelations}
          steps={steps}
          breakdown={breakdown ?? {}}
          availableRecipes={availableRecipes}
        />
      ) : (
        <RecipeEditor
          categories={categories}
          inventory={inventory}
          availableRecipes={availableRecipes}
          name={draftName}
          setName={setDraftName}
          categoryId={draftCategoryId}
          setCategoryId={setDraftCategoryId}
          yieldQuantity={draftYieldQuantity}
          setYieldQuantity={setDraftYieldQuantity}
          yieldUnit={draftYieldUnit}
          setYieldUnit={setDraftYieldUnit}
          electricTime={draftElectricTime}
          setElectricTime={setDraftElectricTime}
          gasTime={draftGasTime}
          setGasTime={setDraftGasTime}
          laborCost={draftLaborCost}
          setLaborCost={setDraftLaborCost}
          costPercentage={draftCostPercentage}
          setCostPercentage={setDraftCostPercentage}
          wastePercentage={draftWastePercentage}
          setWastePercentage={setDraftWastePercentage}
          ingredients={draftIngredients}
          updateIngredient={updateDraftIngredient}
          addIngredient={addDraftIngredient}
          removeIngredient={removeDraftIngredient}
          subrecipes={draftSubrecipes}
          updateSubrecipe={updateDraftSubrecipe}
          addSubrecipe={addDraftSubrecipe}
          removeSubrecipe={removeDraftSubrecipe}
          steps={draftSteps}
          updateStep={updateDraftStep}
          addStep={addDraftStep}
          removeStep={removeDraftStep}
          moveStep={moveDraftStep}
          calculations={draftCalculations}
        />
      )}
    </div>
  );
}

/* =========================================================
   VISTA DE RECETA
========================================================= */

function RecipeView({
  recipe,
  category,
  ingredientRelations,
  subrecipeRelations,
  steps,
  breakdown,
  availableRecipes,
}) {
  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#3b2a20] to-[#6f4a32] p-7 text-white shadow-xl sm:p-9">
        <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-black text-orange-100">
          {category?.name || "Sin categoría"}
        </span>

        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
          {recipe.name}
        </h1>

        <div className="mt-6 flex flex-wrap gap-3 text-sm font-bold text-stone-100">
          <span className="rounded-full bg-white/10 px-4 py-2">
            Rinde {quantity(recipe.yield_quantity)} {recipe.yield_unit}
          </span>

          <span className="rounded-full bg-white/10 px-4 py-2">
            Costo objetivo {quantity(recipe.cost_percentage)}%
          </span>

          <span className="rounded-full bg-white/10 px-4 py-2">
            Merma {quantity(recipe.waste_percentage)}%
          </span>

          <span className="rounded-full bg-white/10 px-4 py-2">
            ⚡ {quantity(recipe.electric_time_minutes)} min
          </span>

          <span className="rounded-full bg-white/10 px-4 py-2">
            🔥 {quantity(recipe.gas_time_minutes)} min
          </span>
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-7">
          {/* INGREDIENTES DIRECTOS */}

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-100 p-6">
              <h2 className="text-xl font-black text-stone-900">
                Ingredientes
              </h2>
            </div>

            {ingredientRelations.length === 0 ? (
              <div className="p-6 text-sm text-stone-500">
                Esta receta no utiliza ingredientes directos.
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {ingredientRelations.map((relation) => {
                  const ingredient = getRelatedObject(relation.ingredients);

                  if (!ingredient) {
                    return null;
                  }

                  const itemCost =
                    getIngredientUnitCost(ingredient) *
                    Number(relation.quantity_needed || 0);

                  const enoughStock =
                    Boolean(ingredient.is_active) &&
                    Number(ingredient.current_stock || 0) >=
                      Number(relation.quantity_needed || 0);

                  return (
                    <div
                      key={relation.id}
                      className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                    >
                      <div>
                        <p className="font-black text-stone-900">
                          {ingredient.name}
                        </p>

                        <p className="mt-1 text-xs text-stone-500">
                          Disponible: {quantity(ingredient.current_stock)}{" "}
                          {ingredient.unit}
                        </p>
                      </div>

                      <p className="font-bold text-stone-700">
                        {quantity(relation.quantity_needed)} {ingredient.unit}
                      </p>

                      <div className="text-right">
                        <p className="font-black text-stone-800">
                          {money(itemCost)}
                        </p>

                        <span
                          className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-black ${
                            enoughStock
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {enoughStock ? "Disponible" : "Insuficiente"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SUBRECETAS */}

          {subrecipeRelations.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-[#e3cdb7] bg-white shadow-sm">
              <div className="border-b border-[#f0e0d0] bg-[#fffaf5] p-6">
                <h2 className="text-xl font-black text-[#3b2a20]">
                  Recetas utilizadas como ingrediente
                </h2>

                <p className="mt-1 text-sm text-stone-500">
                  Preparaciones como coberturas, cremas, rellenos o masas
                  previamente registradas.
                </p>
              </div>

              <div className="divide-y divide-stone-100">
                {subrecipeRelations.map((relation) => {
                  const subrecipe = getRelatedObject(relation.subrecipe);

                  if (!subrecipe) {
                    return null;
                  }

                  const option = availableRecipes.find(
                    (item) => item.id === relation.subrecipe_id,
                  );

                  const unitCost =
                    Number(option?.breakdown?.cost_per_unit) || 0;

                  const itemCost =
                    unitCost * Number(relation.quantity_needed || 0);

                  return (
                    <div
                      key={relation.id}
                      className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                    >
                      <div>
                        <p className="font-black text-stone-900">
                          {subrecipe.name}
                        </p>

                        <p className="mt-1 text-xs text-stone-500">
                          La receta completa rinde{" "}
                          {quantity(subrecipe.yield_quantity)}{" "}
                          {subrecipe.yield_unit}
                        </p>
                      </div>

                      <p className="font-bold text-stone-700">
                        {quantity(relation.quantity_needed)}{" "}
                        {subrecipe.yield_unit}
                      </p>

                      <div className="text-right">
                        <p className="font-black text-[#8b5e3c]">
                          {money(itemCost)}
                        </p>

                        <p className="mt-1 text-xs text-stone-500">
                          {money(unitCost, 4)} / {subrecipe.yield_unit}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* PREPARACIÓN */}

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-100 p-6">
              <h2 className="text-xl font-black text-stone-900">Preparación</h2>
            </div>

            <div className="space-y-5 p-6">
              {steps.length === 0 ? (
                <p className="text-sm text-stone-500">Sin pasos registrados.</p>
              ) : (
                steps.map((step) => (
                  <div key={step.id} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 font-black text-orange-800">
                      {step.step_number}
                    </span>

                    <p className="pt-2 text-sm leading-6 text-stone-700">
                      {step.description}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <CostSummary calculations={breakdown} yieldUnit={recipe.yield_unit} />
      </div>
    </>
  );
}

/* =========================================================
   EDITOR
========================================================= */

function RecipeEditor({
  categories,
  inventory,
  availableRecipes,

  name,
  setName,

  categoryId,
  setCategoryId,

  yieldQuantity,
  setYieldQuantity,

  yieldUnit,
  setYieldUnit,

  electricTime,
  setElectricTime,

  gasTime,
  setGasTime,

  laborCost,
  setLaborCost,

  costPercentage,
  setCostPercentage,

  wastePercentage,
  setWastePercentage,

  ingredients,
  updateIngredient,
  addIngredient,
  removeIngredient,

  subrecipes,
  updateSubrecipe,
  addSubrecipe,
  removeSubrecipe,

  steps,
  updateStep,
  addStep,
  removeStep,
  moveStep,

  calculations,
}) {
  return (
    <div className="grid gap-7 xl:grid-cols-[1.45fr_0.75fr]">
      <div className="space-y-7">
        {/* INFORMACIÓN */}

        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-stone-900">
            Información general
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Nombre
              </span>

              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Categoría
              </span>

              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
              >
                <option value="">Selecciona</option>

                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-[1fr_120px] gap-3">
              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Rendimiento
                </span>

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={yieldQuantity}
                  onChange={(event) => setYieldQuantity(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Unidad
                </span>

                <select
                  value={yieldUnit}
                  onChange={(event) => setYieldUnit(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                >
                  <option value="pz">pz</option>

                  <option value="g">g</option>

                  <option value="ml">ml</option>
                </select>
              </label>
            </div>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Mano de obra
              </span>

              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                  $
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={laborCost}
                  onChange={(event) => setLaborCost(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 py-3 pl-9 pr-4 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </div>
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Minutos de electricidad
              </span>

              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={electricTime}
                  onChange={(event) => setElectricTime(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-16 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />

                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                  min
                </span>
              </div>
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Minutos de gas
              </span>

              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={gasTime}
                  onChange={(event) => setGasTime(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-16 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />

                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                  min
                </span>
              </div>
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                El costo representa
              </span>

              <div className="relative">
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={costPercentage}
                  onChange={(event) => setCostPercentage(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-12 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />

                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-stone-400">
                  %
                </span>
              </div>

              <p className="mt-2 text-xs text-stone-500">Normalmente 35%.</p>
            </label>

            <label>
              <span className="mb-2 block text-sm font-bold text-stone-700">
                Merma
              </span>

              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={wastePercentage}
                  onChange={(event) => setWastePercentage(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-12 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />

                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-stone-400">
                  %
                </span>
              </div>

              <p className="mt-2 text-xs text-stone-500">Normalmente 10%.</p>
            </label>
          </div>
        </section>

        {/* INGREDIENTES */}

        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 p-6">
            <div>
              <h2 className="text-xl font-black text-stone-900">
                Ingredientes
              </h2>

              <p className="mt-1 text-sm text-stone-500">
                Insumos registrados en el inventario.
              </p>
            </div>

            <button
              type="button"
              onClick={addIngredient}
              className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-800"
            >
              + Ingrediente
            </button>
          </div>

          <div className="space-y-4 p-6">
            {ingredients.length === 0 && (
              <p className="text-sm text-stone-500">
                No hay ingredientes directos.
              </p>
            )}

            {ingredients.map((row, index) => {
              const selected = inventory.find(
                (item) => item.id === row.ingredientId,
              );

              const rowCost =
                getIngredientUnitCost(selected) *
                Number(row.quantityNeeded || 0);

              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1fr_180px_130px_auto] md:items-end"
                >
                  <label>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Insumo
                    </span>

                    <select
                      value={row.ingredientId}
                      onChange={(event) =>
                        updateIngredient(
                          index,
                          "ingredientId",
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    >
                      <option value="">Selecciona</option>

                      {inventory.map((ingredient) => (
                        <option key={ingredient.id} value={ingredient.id}>
                          {ingredient.name}
                          {!ingredient.is_active ? " · Inactivo" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Cantidad
                    </span>

                    <div className="relative">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.quantityNeeded}
                        onChange={(event) =>
                          updateIngredient(
                            index,
                            "quantityNeeded",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-14 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                      />

                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                        {selected?.unit || "—"}
                      </span>
                    </div>
                  </label>

                  <div>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Costo
                    </span>

                    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-right font-black text-stone-800">
                      {money(rowCost)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeIngredient(index)}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700"
                  >
                    Quitar
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* RECETAS COMO INGREDIENTE */}

        <section className="overflow-hidden rounded-2xl border border-[#e3cdb7] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#f0e0d0] bg-[#fffaf5] p-6">
            <div>
              <h2 className="text-xl font-black text-[#3b2a20]">
                Recetas como ingrediente
              </h2>

              <p className="mt-1 text-sm text-stone-500">
                Coberturas, cremas, masas, rellenos u otras preparaciones.
              </p>
            </div>

            <button
              type="button"
              onClick={addSubrecipe}
              disabled={availableRecipes.length === 0}
              className="rounded-xl border border-[#8b5e3c] bg-white px-4 py-2 text-sm font-black text-[#8b5e3c] disabled:opacity-40"
            >
              + Receta
            </button>
          </div>

          <div className="space-y-4 p-6">
            {subrecipes.length === 0 && (
              <p className="text-sm text-stone-500">
                No se utiliza ninguna otra receta.
              </p>
            )}

            {subrecipes.map((row, index) => {
              const selected = availableRecipes.find(
                (item) => item.id === row.subrecipeId,
              );

              const unitCost = Number(selected?.breakdown?.cost_per_unit) || 0;

              const rowCost = unitCost * Number(row.quantityNeeded || 0);

              return (
                <div
                  key={index}
                  className="grid gap-3 rounded-xl border border-[#e6d4c1] bg-[#fffaf5] p-4 md:grid-cols-[1fr_180px_130px_auto] md:items-end"
                >
                  <label>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Receta
                    </span>

                    <select
                      value={row.subrecipeId}
                      onChange={(event) =>
                        updateSubrecipe(
                          index,
                          "subrecipeId",
                          event.target.value,
                        )
                      }
                      className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                    >
                      <option value="">Selecciona</option>

                      {availableRecipes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · rinde {quantity(item.yield_quantity)}{" "}
                          {item.yield_unit}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Cantidad
                    </span>

                    <div className="relative">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.quantityNeeded}
                        onChange={(event) =>
                          updateSubrecipe(
                            index,
                            "quantityNeeded",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-14 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                      />

                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                        {selected?.yield_unit || "—"}
                      </span>
                    </div>
                  </label>

                  <div>
                    <span className="mb-2 block text-xs font-black uppercase tracking-wider text-stone-500">
                      Costo
                    </span>

                    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-right font-black text-[#8b5e3c]">
                      {money(rowCost)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeSubrecipe(index)}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700"
                  >
                    Quitar
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* PREPARACIÓN */}

        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 p-6">
            <div>
              <h2 className="text-xl font-black text-stone-900">Preparación</h2>

              <p className="mt-1 text-sm text-stone-500">
                Modifica, agrega, elimina o reordena los pasos.
              </p>
            </div>

            <button
              type="button"
              onClick={addStep}
              className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-black text-orange-800"
            >
              + Paso
            </button>
          </div>

          <div className="space-y-4 p-6">
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3b2a20] font-black text-white">
                  {index + 1}
                </span>

                <textarea
                  value={step.description}
                  onChange={(event) => updateStep(index, event.target.value)}
                  rows={3}
                  className="min-h-24 flex-1 resize-y rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />

                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-black disabled:opacity-30"
                  >
                    ↑
                  </button>

                  <button
                    type="button"
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-black disabled:opacity-30"
                  >
                    ↓
                  </button>

                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <CostSummary calculations={calculations} yieldUnit={yieldUnit} />
    </div>
  );
}

/* =========================================================
   RESUMEN DE COSTOS
========================================================= */

function CostSummary({ calculations, yieldUnit }) {
  const data = calculations ?? {};

  return (
    <aside>
      <div className="sticky top-28 overflow-hidden rounded-2xl bg-[#3b2a20] text-white shadow-xl">
        <div className="border-b border-white/10 p-6">
          <p className="text-xs font-black uppercase tracking-[.16em] text-orange-200">
            Costeo
          </p>

          <h2 className="mt-2 text-xl font-black">Precio de venta</h2>
        </div>

        <div className="space-y-4 p-6 text-sm">
          <CostRow
            label="Ingredientes"
            value={money(data.direct_ingredient_cost)}
          />

          <CostRow label="Otras recetas" value={money(data.subrecipe_cost)} />

          <CostRow label="Electricidad" value={money(data.electric_cost)} />

          <CostRow label="Gas" value={money(data.gas_cost)} />

          <CostRow label="Mano de obra" value={money(data.labor_cost)} />

          <div className="border-t border-white/15 pt-4">
            <CostRow
              label="Costo real del lote"
              value={money(data.total_cost)}
            />

            <div className="mt-3">
              <CostRow
                label={`Costo por ${yieldUnit}`}
                value={money(data.cost_per_unit)}
              />
            </div>
          </div>

          <div className="rounded-xl bg-white/10 p-4">
            <CostRow
              label={`Costo = ${quantity(data.cost_percentage)}%`}
              value={money(data.cost_per_unit)}
            />

            <div className="mt-3">
              <CostRow
                label="Subtotal venta"
                value={money(data.subtotal_sale_per_unit)}
              />
            </div>

            <div className="mt-3">
              <CostRow
                label={`Merma ${quantity(data.waste_percentage)}%`}
                value={money(data.waste_per_unit)}
              />
            </div>

            <div className="mt-3 border-t border-white/10 pt-3">
              <CostRow
                label="Ganancia final estimada"
                value={money(data.profit_per_unit)}
              />
            </div>
          </div>

          <div className="rounded-xl bg-orange-100 p-4 text-[#3b2a20]">
            <p className="text-xs font-black uppercase tracking-[.14em] text-orange-800">
              Precio final por {yieldUnit}
            </p>

            <p className="mt-2 text-3xl font-black">
              {money(data.final_price_per_unit)}
            </p>

            <div className="mt-4 border-t border-orange-200 pt-3">
              <p className="text-xs font-bold text-stone-600">
                Venta estimada del lote
              </p>

              <p className="mt-1 text-lg font-black">
                {money(data.final_price_batch)}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-white/10 p-4 text-xs leading-6 text-stone-200">
            <p>
              El costo real incluye ingredientes, otras recetas, electricidad,
              gas y mano de obra.
            </p>

            <p className="mt-2">
              Ese costo representa el{" "}
              <strong>{quantity(data.cost_percentage)}%</strong> del subtotal de
              venta.
            </p>

            <p className="mt-2">
              Después se agrega{" "}
              <strong>{quantity(data.waste_percentage)}%</strong> como reserva
              de merma.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function CostRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-stone-300">{label}</span>

      <span className="font-black text-white">{value}</span>
    </div>
  );
}
