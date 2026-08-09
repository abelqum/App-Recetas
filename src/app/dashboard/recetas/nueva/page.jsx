"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

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

  const average = Number(ingredient.average_unit_cost);

  if (Number.isFinite(average) && average > 0) {
    return average;
  }

  const purchaseQuantity = Number(ingredient.purchase_quantity) || 0;

  const purchaseCost = Number(ingredient.purchase_cost) || 0;

  return purchaseQuantity > 0 ? purchaseCost / purchaseQuantity : 0;
}

async function getInitialData() {
  const [ingredientsResult, categoriesResult, configResult, recipesResult] =
    await Promise.all([
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
        current_stock
      `,
        )
        .eq("is_active", true)
        .order("name"),

      supabase.from("categories").select("id, name").order("name"),

      supabase
        .from("app_config")
        .select(
          `
        kwh_cost,
        electric_power_watts,
        oven_power_watts,
        gas_hourly_cost
      `,
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

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
        .order("name"),
    ]);

  if (ingredientsResult.error) {
    throw ingredientsResult.error;
  }

  if (categoriesResult.error) {
    throw categoriesResult.error;
  }

  if (configResult.error) {
    throw configResult.error;
  }

  if (recipesResult.error) {
    throw recipesResult.error;
  }

  const recipeOptions = await Promise.all(
    (recipesResult.data ?? []).map(async (recipe) => {
      const { data, error } = await supabase.rpc("get_recipe_cost_breakdown", {
        p_recipe_id: recipe.id,
      });

      if (error) {
        throw error;
      }

      return {
        ...recipe,
        breakdown: data,
      };
    }),
  );

  const config = configResult.data ?? {};

  return {
    inventory: ingredientsResult.data ?? [],
    categories: categoriesResult.data ?? [],

    recipes: recipeOptions,

    config: {
      kwhCost: Number(config.kwh_cost) || 0,

      electricPowerWatts:
        Number(config.electric_power_watts) ||
        Number(config.oven_power_watts) ||
        0,

      gasHourlyCost: Number(config.gas_hourly_cost) || 0,
    },
  };
}

export default function NuevaRecetaPage() {
  const router = useRouter();

  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [availableRecipes, setAvailableRecipes] = useState([]);

  const [config, setConfig] = useState({
    kwhCost: 0,
    electricPowerWatts: 0,
    gasHourlyCost: 0,
  });

  const [recipeName, setRecipeName] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [yieldQuantity, setYieldQuantity] = useState("12");

  const [yieldUnit, setYieldUnit] = useState("pz");

  const [electricTimeMinutes, setElectricTimeMinutes] = useState("0");

  const [gasTimeMinutes, setGasTimeMinutes] = useState("0");

  const [laborCost, setLaborCost] = useState("");

  const [costPercentage, setCostPercentage] = useState("35");

  const [wastePercentage, setWastePercentage] = useState("10");

  const [recipeIngredients, setRecipeIngredients] = useState([
    {
      ingredientId: "",
      quantityNeeded: "",
    },
  ]);

  const [subrecipes, setSubrecipes] = useState([]);

  const [steps, setSteps] = useState([
    {
      description: "",
    },
  ]);

  const [loading, setLoading] = useState(true);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        const data = await getInitialData();

        if (!active) return;

        setInventory(data.inventory);
        setCategories(data.categories);
        setAvailableRecipes(data.recipes);
        setConfig(data.config);
      } catch (error) {
        console.error(error);

        if (active) {
          await Swal.fire({
            icon: "error",
            title: "No se pudo preparar la receta",
            text: error?.message || "Ocurrió un error al cargar los datos.",
            confirmButtonColor: "#8b5e3c",
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  const ingredientCosts = useMemo(() => {
    return recipeIngredients.map((row) => {
      const ingredient = inventory.find((item) => item.id === row.ingredientId);

      const amount = Number(row.quantityNeeded) || 0;

      const unitCost = getIngredientUnitCost(ingredient);

      return {
        ingredient,
        cost: amount * unitCost,
      };
    });
  }, [inventory, recipeIngredients]);

  const subrecipeCosts = useMemo(() => {
    return subrecipes.map((row) => {
      const recipe = availableRecipes.find(
        (item) => item.id === row.subrecipeId,
      );

      const amount = Number(row.quantityNeeded) || 0;

      const unitCost = Number(recipe?.breakdown?.cost_per_unit) || 0;

      return {
        recipe,
        unitCost,
        cost: amount * unitCost,
      };
    });
  }, [availableRecipes, subrecipes]);

  const calculations = useMemo(() => {
    const ingredientTotal = ingredientCosts.reduce(
      (sum, item) => sum + item.cost,
      0,
    );

    const subrecipeTotal = subrecipeCosts.reduce(
      (sum, item) => sum + item.cost,
      0,
    );

    const electricMinutes = Number(electricTimeMinutes) || 0;

    const gasMinutes = Number(gasTimeMinutes) || 0;

    const electricCost =
      (config.electricPowerWatts / 1000) *
      (electricMinutes / 60) *
      config.kwhCost;

    const gasCost = (gasMinutes / 60) * config.gasHourlyCost;

    const parsedLabor = Number(laborCost) || 0;

    const totalCost =
      ingredientTotal + subrecipeTotal + electricCost + gasCost + parsedLabor;

    const yieldAmount = Number(yieldQuantity) || 0;

    const costPerUnit = yieldAmount > 0 ? totalCost / yieldAmount : 0;

    const costPercent = Number(costPercentage) || 0;

    const subtotalSalePerUnit =
      costPercent > 0 ? costPerUnit / (costPercent / 100) : 0;

    const wastePercent = Number(wastePercentage) || 0;

    const wastePerUnit = subtotalSalePerUnit * (wastePercent / 100);

    const finalPricePerUnit = subtotalSalePerUnit + wastePerUnit;

    const profitPerUnit = subtotalSalePerUnit - costPerUnit;

    const finalPriceBatch = finalPricePerUnit * yieldAmount;

    return {
      ingredientTotal,
      subrecipeTotal,

      electricCost,
      gasCost,
      laborCost: parsedLabor,

      totalCost,

      costPerUnit,

      subtotalSalePerUnit,
      wastePerUnit,

      profitPerUnit,

      finalPricePerUnit,
      finalPriceBatch,
    };
  }, [
    config,
    costPercentage,
    electricTimeMinutes,
    gasTimeMinutes,
    ingredientCosts,
    laborCost,
    subrecipeCosts,
    wastePercentage,
    yieldQuantity,
  ]);

  const updateIngredient = (index, field, value) => {
    setRecipeIngredients((current) =>
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

  const addIngredient = () => {
    setRecipeIngredients((current) => [
      ...current,
      {
        ingredientId: "",
        quantityNeeded: "",
      },
    ]);
  };

  const removeIngredient = (index) => {
    setRecipeIngredients((current) =>
      current.filter((_, rowIndex) => rowIndex !== index),
    );
  };

  const updateSubrecipe = (index, field, value) => {
    setSubrecipes((current) =>
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

  const addSubrecipe = () => {
    setSubrecipes((current) => [
      ...current,
      {
        subrecipeId: "",
        quantityNeeded: "",
      },
    ]);
  };

  const removeSubrecipe = (index) => {
    setSubrecipes((current) =>
      current.filter((_, rowIndex) => rowIndex !== index),
    );
  };

  const updateStep = (index, value) => {
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index
          ? {
              description: value,
            }
          : step,
      ),
    );
  };

  const addStep = () => {
    setSteps((current) => [
      ...current,
      {
        description: "",
      },
    ]);
  };

  const removeStep = (index) => {
    setSteps((current) => {
      const next = current.filter((_, stepIndex) => stepIndex !== index);

      return next.length > 0 ? next : [{ description: "" }];
    });
  };

  const moveStep = (index, direction) => {
    setSteps((current) => {
      const destination = index + direction;

      if (destination < 0 || destination >= current.length) {
        return current;
      }

      const copy = [...current];

      [copy[index], copy[destination]] = [copy[destination], copy[index]];

      return copy;
    });
  };

  const validate = async () => {
    if (!recipeName.trim()) {
      await Swal.fire({
        icon: "warning",
        title: "Nombre requerido",
        text: "Escribe el nombre de la receta.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    if (!categoryId) {
      await Swal.fire({
        icon: "warning",
        title: "Categoría requerida",
        text: "Selecciona una categoría.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    if (!Number.isFinite(Number(yieldQuantity)) || Number(yieldQuantity) <= 0) {
      await Swal.fire({
        icon: "warning",
        title: "Rendimiento inválido",
        text: "Indica cuántas piezas, gramos o mililitros rinde la receta.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const ingredients = recipeIngredients.filter(
      (row) => row.ingredientId || String(row.quantityNeeded).trim(),
    );

    const recipeRows = subrecipes.filter(
      (row) => row.subrecipeId || String(row.quantityNeeded).trim(),
    );

    if (ingredients.length === 0 && recipeRows.length === 0) {
      await Swal.fire({
        icon: "warning",
        title: "Faltan ingredientes",
        text: "Agrega al menos un insumo o una receta como ingrediente.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const invalidIngredient = ingredients.find(
      (row) => !row.ingredientId || Number(row.quantityNeeded) <= 0,
    );

    if (invalidIngredient) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente incompleto",
        text: "Selecciona el insumo y escribe una cantidad mayor que cero.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const ingredientIds = ingredients.map((row) => row.ingredientId);

    if (new Set(ingredientIds).size !== ingredientIds.length) {
      await Swal.fire({
        icon: "warning",
        title: "Ingrediente repetido",
        text: "Un mismo ingrediente solamente debe aparecer una vez.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const invalidSubrecipe = recipeRows.find(
      (row) => !row.subrecipeId || Number(row.quantityNeeded) <= 0,
    );

    if (invalidSubrecipe) {
      await Swal.fire({
        icon: "warning",
        title: "Receta incompleta",
        text: "Selecciona la receta y la cantidad que utilizarás.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const subrecipeIds = recipeRows.map((row) => row.subrecipeId);

    if (new Set(subrecipeIds).size !== subrecipeIds.length) {
      await Swal.fire({
        icon: "warning",
        title: "Receta repetida",
        text: "Una misma receta solamente debe aparecer una vez.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const percentage = Number(costPercentage);

    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      await Swal.fire({
        icon: "warning",
        title: "Porcentaje de costo inválido",
        text: "Debe ser mayor que 0 y máximo 100%.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    const waste = Number(wastePercentage);

    if (!Number.isFinite(waste) || waste < 0 || waste > 100) {
      await Swal.fire({
        icon: "warning",
        title: "Merma inválida",
        text: "La merma debe estar entre 0 y 100%.",
        confirmButtonColor: "#8b5e3c",
      });

      return false;
    }

    return true;
  };

  const handleSave = async () => {
    const valid = await validate();

    if (!valid) return;

    const ingredientsPayload = recipeIngredients
      .filter((row) => row.ingredientId)
      .map((row) => ({
        ingredient_id: row.ingredientId,

        quantity_needed: Number(row.quantityNeeded),
      }));

    const subrecipesPayload = subrecipes
      .filter((row) => row.subrecipeId)
      .map((row) => ({
        subrecipe_id: row.subrecipeId,

        quantity_needed: Number(row.quantityNeeded),
      }));

    const stepsPayload = steps
      .map((step) => ({
        description: step.description.trim(),
      }))
      .filter((step) => step.description);

    try {
      setIsSaving(true);

      const { data, error } = await supabase.rpc("create_recipe_with_details", {
        p_name: recipeName.trim(),

        p_category_id: categoryId,

        p_labor_cost: Number(laborCost || 0),

        p_electric_time_minutes: Math.trunc(Number(electricTimeMinutes || 0)),

        p_gas_time_minutes: Math.trunc(Number(gasTimeMinutes || 0)),

        p_yield_quantity: Number(yieldQuantity),

        p_yield_unit: yieldUnit,

        p_cost_percentage: Number(costPercentage),

        p_waste_percentage: Number(wastePercentage),

        p_ingredients: ingredientsPayload,

        p_subrecipes: subrecipesPayload,

        p_steps: stepsPayload,
      });

      if (error) {
        throw error;
      }

      await Swal.fire({
        icon: "success",
        title: "Receta guardada",
        text: "La receta se registró correctamente.",
        timer: 1600,
        showConfirmButton: false,
      });

      router.push(`/dashboard/recetas/${data}`);
    } catch (error) {
      console.error(error);

      await Swal.fire({
        icon: "error",
        title: "No se pudo guardar la receta",
        text: error?.message || "Ocurrió un error.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white py-20 text-center text-stone-500 shadow-sm">
        Cargando datos...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-3 text-sm font-bold text-stone-500 hover:text-stone-900"
          >
            ← Volver
          </button>

          <p className="text-xs font-black uppercase tracking-[.16em] text-orange-700">
            Recetario
          </p>

          <h1 className="mt-1 text-3xl font-black text-stone-900">
            Nueva receta
          </h1>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-xl bg-[#8b5e3c] px-6 py-3 text-sm font-black text-white shadow-md transition hover:bg-[#70472d] disabled:opacity-60"
        >
          {isSaving ? "Guardando..." : "Guardar receta"}
        </button>
      </div>

      <div className="grid gap-7 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-7">
          {/* INFORMACIÓN GENERAL */}
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
                  value={recipeName}
                  onChange={(event) => setRecipeName(event.target.value)}
                  placeholder="Ej. Rol de canela"
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Categoría
                </span>

                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                >
                  <option value="">Selecciona</option>

                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-[1fr_130px] gap-3">
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
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-sm font-bold text-stone-700">
                    Unidad
                  </span>

                  <select
                    value={yieldUnit}
                    onChange={(event) => setYieldUnit(event.target.value)}
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-3 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
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

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={laborCost}
                  onChange={(event) => setLaborCost(event.target.value)}
                  placeholder="80.00"
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Minutos electricidad
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={electricTimeMinutes}
                  onChange={(event) =>
                    setElectricTimeMinutes(event.target.value)
                  }
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
              </label>

              <label>
                <span className="mb-2 block text-sm font-bold text-stone-700">
                  Minutos gas
                </span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={gasTimeMinutes}
                  onChange={(event) => setGasTimeMinutes(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                />
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
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-12 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                    %
                  </span>
                </div>

                <p className="mt-2 text-xs text-stone-500">Recomendado: 35%.</p>
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
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-12 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">
                    %
                  </span>
                </div>
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
                  Insumos del inventario.
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
              {recipeIngredients.length === 0 && (
                <p className="text-sm text-stone-500">
                  No hay ingredientes directos.
                </p>
              )}

              {recipeIngredients.map((row, index) => {
                const info = ingredientCosts[index];

                return (
                  <div
                    key={index}
                    className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1fr_180px_130px_auto] md:items-end"
                  >
                    <label>
                      <span className="mb-2 block text-xs font-black uppercase text-stone-500">
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
                        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3"
                      >
                        <option value="">Selecciona</option>

                        {inventory.map((ingredient) => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="mb-2 block text-xs font-black uppercase text-stone-500">
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
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-14"
                        />

                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                          {info?.ingredient?.unit || "—"}
                        </span>
                      </div>
                    </label>

                    <div>
                      <span className="mb-2 block text-xs font-black uppercase text-stone-500">
                        Costo
                      </span>

                      <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-right font-black">
                        {money(info?.cost)}
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

          {/* SUBRECETAS */}
          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 p-6">
              <div>
                <h2 className="text-xl font-black text-stone-900">
                  Recetas como ingrediente
                </h2>

                <p className="mt-1 text-sm text-stone-500">
                  Ejemplo: cobertura, crema, ganache o alguna preparación
                  previa.
                </p>
              </div>

              <button
                type="button"
                onClick={addSubrecipe}
                disabled={availableRecipes.length === 0}
                className="rounded-xl border border-[#8b5e3c] bg-[#fffaf5] px-4 py-2 text-sm font-black text-[#8b5e3c] disabled:opacity-40"
              >
                + Receta
              </button>
            </div>

            <div className="space-y-4 p-6">
              {subrecipes.length === 0 && (
                <p className="text-sm text-stone-500">
                  No estás usando otra receta como ingrediente.
                </p>
              )}

              {subrecipes.map((row, index) => {
                const info = subrecipeCosts[index];

                return (
                  <div
                    key={index}
                    className="grid gap-3 rounded-xl border border-[#e6d4c1] bg-[#fffaf5] p-4 md:grid-cols-[1fr_180px_130px_auto] md:items-end"
                  >
                    <label>
                      <span className="mb-2 block text-xs font-black uppercase text-stone-500">
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
                        className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3"
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
                      <span className="mb-2 block text-xs font-black uppercase text-stone-500">
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
                          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 pr-14"
                        />

                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-stone-400">
                          {info?.recipe?.yield_unit || "—"}
                        </span>
                      </div>
                    </label>

                    <div>
                      <span className="mb-2 block text-xs font-black uppercase text-stone-500">
                        Costo
                      </span>

                      <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-right font-black">
                        {money(info?.cost)}
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

          {/* PASOS */}
          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 p-6">
              <h2 className="text-xl font-black text-stone-900">Preparación</h2>

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
                    rows={3}
                    value={step.description}
                    onChange={(event) => updateStep(index, event.target.value)}
                    className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3"
                  />

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                      className="rounded-lg border bg-white px-3 py-2 disabled:opacity-30"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                      className="rounded-lg border bg-white px-3 py-2 disabled:opacity-30"
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* RESUMEN */}
        <aside>
          <div className="sticky top-28 overflow-hidden rounded-2xl bg-[#3b2a20] text-white shadow-xl">
            <div className="border-b border-white/10 p-6">
              <p className="text-xs font-black uppercase tracking-[.16em] text-orange-200">
                Costeo
              </p>

              <h2 className="mt-2 text-xl font-black">
                Precio por {yieldUnit}
              </h2>
            </div>

            <div className="space-y-4 p-6 text-sm">
              <CostRow
                label="Ingredientes"
                value={money(calculations.ingredientTotal)}
              />

              <CostRow
                label="Otras recetas"
                value={money(calculations.subrecipeTotal)}
              />

              <CostRow
                label="Electricidad"
                value={money(calculations.electricCost)}
              />

              <CostRow label="Gas" value={money(calculations.gasCost)} />

              <CostRow
                label="Mano de obra"
                value={money(calculations.laborCost)}
              />

              <div className="border-t border-white/15 pt-4">
                <CostRow
                  label="Costo del lote"
                  value={money(calculations.totalCost)}
                />

                <CostRow
                  label={`Costo / ${yieldUnit}`}
                  value={money(calculations.costPerUnit)}
                />
              </div>

              <div className="rounded-xl bg-white/10 p-4">
                <CostRow
                  label={`Costo = ${costPercentage}%`}
                  value={money(calculations.costPerUnit)}
                />

                <div className="mt-3">
                  <CostRow
                    label="Subtotal venta"
                    value={money(calculations.subtotalSalePerUnit)}
                  />
                </div>

                <div className="mt-3">
                  <CostRow
                    label={`Merma ${wastePercentage}%`}
                    value={money(calculations.wastePerUnit)}
                  />
                </div>

                <div className="mt-3">
                  <CostRow
                    label="Ganancia estimada"
                    value={money(calculations.profitPerUnit)}
                  />
                </div>
              </div>

              <div className="rounded-xl bg-orange-100 p-4 text-[#3b2a20]">
                <p className="text-xs font-black uppercase tracking-[.14em] text-orange-800">
                  Precio final por {yieldUnit}
                </p>

                <p className="mt-2 text-3xl font-black">
                  {money(calculations.finalPricePerUnit)}
                </p>

                <p className="mt-3 text-xs font-bold text-stone-600">
                  Venta del lote completo: {money(calculations.finalPriceBatch)}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
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
