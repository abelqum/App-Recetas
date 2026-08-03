// app/dashboard/recetas/nueva/page.js
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

export default function NuevaRecetaPage() {
  const router = useRouter();

  // Catálogo de ingredientes desde la BD
  const [inventory, setInventory] = useState([]);

  // Estados generales de la receta
  const [recipeName, setRecipeName] = useState("");

  // Ingredientes agregados a la receta
  const [selectedIngredientId, setSelectedIngredientId] = useState("");
  const [ingredientQty, setIngredientQty] = useState("");
  const [recipeIngredients, setRecipeIngredients] = useState([]);

  // Pasos de la receta
  const [currentStep, setCurrentStep] = useState("");
  const [steps, setSteps] = useState([]);

  // Costos y configuración
  const [ovenTime, setOvenTime] = useState(0);
  const [laborCost, setLaborCost] = useState(0);
  const [profitMargin, setProfitMargin] = useState(30); // 30% por defecto

  const [kwhCost, setKwhCost] = useState(0);
  const [loadingInventory, setLoadingInventory] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cargar inventario y configuración al iniciar
  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      const [inventoryResponse, configResponse] = await Promise.all([
        supabase.from("ingredients").select("*").order("name"),
        supabase.from("app_config").select("kwh_cost").limit(1).maybeSingle(),
      ]);

      if (!active) return;

      if (inventoryResponse.error) {
        void Swal.fire({
          icon: "error",
          title: "No se pudo cargar el inventario",
          text: inventoryResponse.error.message,
          confirmButtonColor: "#8b5e3c",
        });
      } else {
        setInventory(inventoryResponse.data ?? []);
      }

      if (!configResponse.error) {
        setKwhCost(Number(configResponse.data?.kwh_cost) || 0);
      }

      setLoadingInventory(false);
    }

    void loadInitialData();
    return () => { active = false; };
  }, []);

  // --- LÓGICA DE INGREDIENTES ---
  const addIngredient = () => {
    const parsedQuantity = Number(ingredientQty);
    if (!selectedIngredientId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      void Swal.fire({ icon: "warning", title: "Cantidad inválida", text: "Selecciona un insumo e ingresa una cantidad mayor que cero.", confirmButtonColor: "#8b5e3c" });
      return;
    }

    const ingredient = inventory.find((i) => String(i.id) === String(selectedIngredientId));
    if (!ingredient) return;

    if (recipeIngredients.some((item) => String(item.id) === String(ingredient.id))) {
      void Swal.fire({ icon: "info", title: "Insumo repetido", text: "Ese insumo ya está agregado a la receta.", confirmButtonColor: "#8b5e3c" });
      return;
    }
    const unitCost = ingredient.purchase_cost / ingredient.purchase_quantity;
    const totalCost = unitCost * parsedQuantity;

    setRecipeIngredients([
      ...recipeIngredients,
      {
        ...ingredient,
        quantityUsed: parsedQuantity,
        calculatedCost: totalCost,
      },
    ]);

    setSelectedIngredientId("");
    setIngredientQty("");
  };

  const removeIngredient = (index) => {
    const newIngredients = [...recipeIngredients];
    newIngredients.splice(index, 1);
    setRecipeIngredients(newIngredients);
  };

  // --- LÓGICA DE PASOS ---
  const addStep = () => {
    if (!currentStep.trim()) return;
    setSteps([...steps, currentStep]);
    setCurrentStep("");
  };

  const removeStep = (index) => {
    const newSteps = [...steps];
    newSteps.splice(index, 1);
    setSteps(newSteps);
  };

  // --- CÁLCULOS EN TIEMPO REAL ---
  const insumosTotal = recipeIngredients.reduce(
    (sum, item) => sum + item.calculatedCost,
    0,
  );
  const lightTotal = (parseFloat(ovenTime || 0) / 60) * kwhCost;
  const productionCost = insumosTotal + lightTotal + parseFloat(laborCost || 0);
  const suggestedPrice =
    productionCost + productionCost * (parseFloat(profitMargin || 0) / 100);

  // --- GUARDAR RECETA EN BASE DE DATOS ---
  const handleSaveRecipe = async () => {
    if (!recipeName || recipeIngredients.length === 0) {
      await Swal.fire({ icon: "warning", title: "Receta incompleta", text: "Escribe el nombre y agrega al menos un ingrediente.", confirmButtonColor: "#8b5e3c" });
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Guardar la receta principal
      const { data: recipeData, error: recipeError } = await supabase
        .from("recipes")
        .insert([
          {
            name: recipeName,
            labor_cost: parseFloat(laborCost || 0),
            profit_margin_percent: parseFloat(profitMargin || 0),
            oven_time_minutes: parseInt(ovenTime || 0),
          },
        ])
        .select()
        .single();

      if (recipeError) throw recipeError;

      // 2. Guardar los ingredientes relacionados
      const ingredientsToInsert = recipeIngredients.map((ing) => ({
        recipe_id: recipeData.id,
        ingredient_id: ing.id,
        quantity_needed: ing.quantityUsed,
      }));

      const { error: ingredientsError } = await supabase
        .from("recipe_ingredients")
        .insert(ingredientsToInsert);

      if (ingredientsError) throw ingredientsError;

      // 3. Guardar los pasos
      if (steps.length > 0) {
        const stepsToInsert = steps.map((stepDesc, index) => ({
          recipe_id: recipeData.id,
          step_number: index + 1,
          description: stepDesc,
        }));

        const { error: stepsError } = await supabase
          .from("recipe_steps")
          .insert(stepsToInsert);

        if (stepsError) throw stepsError;
      }

      await Swal.fire({ icon: "success", title: "Receta guardada", text: "La receta se registró correctamente.", timer: 1600, showConfirmButton: false });
      router.push("/dashboard/recetas");
    } catch (error) {
      await Swal.fire({ icon: "error", title: "No se pudo guardar", text: error.message, confirmButtonColor: "#8b5e3c" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl pb-10">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-black tracking-tight text-stone-900">
          📝 Crear Nueva Receta
        </h2>
        <button
          onClick={handleSaveRecipe}
          disabled={isSubmitting}
          className="rounded-xl bg-[#8b5e3c] px-6 py-3 font-black text-white shadow-lg shadow-orange-900/10 transition hover:bg-[#70472d] disabled:opacity-50"
        >
          {isSubmitting ? "Guardando..." : "💾 Guardar Receta"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUMNA IZQUIERDA: Formulario */}
        <div className="lg:col-span-2 space-y-6">
          {/* Nombre de la Receta */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <label className="block text-sm font-bold text-gray-700 mb-2">
              Nombre de la Receta
            </label>
            <input
              type="text"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Ej. Galletas de Chispas de Chocolate"
            />
          </div>

          {/* Ingredientes */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              🛒 Ingredientes
            </h3>

            <div className="flex gap-2 mb-4 items-end">
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">
                  Insumo
                </label>
                <select
                  value={selectedIngredientId}
                  onChange={(e) => setSelectedIngredientId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">{loadingInventory ? "Cargando insumos..." : "Selecciona un insumo..."}</option>
                  {inventory.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} (en {inv.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-sm text-gray-600 mb-1">
                  Cantidad
                </label>
                <input
                  type="number"
                  value={ingredientQty}
                  onChange={(e) => setIngredientQty(e.target.value)}
                  placeholder="Ej. 250"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={addIngredient}
                type="button"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 h-[42px]"
              >
                Agregar
              </button>
            </div>

            {/* Lista de ingredientes agregados */}
            <div className="space-y-2 mt-4">
              {recipeIngredients.map((ing, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100"
                >
                  <span className="font-medium text-gray-700">
                    {ing.quantityUsed} {ing.unit} de {ing.name}
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="text-gray-600 font-medium">
                      ${ing.calculatedCost.toFixed(2)}
                    </span>
                    <button
                      onClick={() => removeIngredient(idx)}
                      className="text-red-500 hover:text-red-700 font-bold"
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
              {recipeIngredients.length === 0 && (
                <p className="text-sm text-gray-400 italic">
                  No hay ingredientes agregados aún.
                </p>
              )}
            </div>
          </div>

          {/* Pasos */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              📖 Pasos de preparación
            </h3>

            <div className="flex gap-2 mb-4 items-end">
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">
                  Descripción del paso
                </label>
                <input
                  type="text"
                  value={currentStep}
                  onChange={(e) => setCurrentStep(e.target.value)}
                  placeholder="Ej. Precalentar el horno a 180 grados..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => e.key === "Enter" && addStep()}
                />
              </div>
              <button
                onClick={addStep}
                type="button"
                className="bg-gray-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-900 h-[42px]"
              >
                + Paso
              </button>
            </div>

            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-start bg-blue-50 p-3 rounded-lg border border-blue-100"
                >
                  <p className="text-sm text-gray-800">
                    <strong className="mr-2">Paso {idx + 1}:</strong> {step}
                  </p>
                  <button
                    onClick={() => removeStep(idx)}
                    className="text-red-500 hover:text-red-700 font-bold ml-4"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: Cálculos y Resumen */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800 mb-4">
              ⚙️ Costos Extra
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Tiempo de Horno (Minutos)
                </label>
                <input
                  type="number"
                  value={ovenTime}
                  onChange={(e) => setOvenTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Tu Mano de Obra ($)
                </label>
                <input
                  type="number"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Margen de Ganancia (%)
                </label>
                <input
                  type="number"
                  value={profitMargin}
                  onChange={(e) => setProfitMargin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* TARJETA DE RESUMEN TOTAL */}
          <div className="rounded-2xl bg-[#3b2a20] p-6 text-white shadow-xl">
            <h3 className="text-lg font-bold border-b border-gray-600 pb-2 mb-4">
              💰 Resumen de Costos
            </h3>

            <div className="space-y-2 text-sm mb-6">
              <div className="flex justify-between">
                <span className="text-gray-300">Total en Insumos:</span>
                <span className="font-medium">${insumosTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Gasto de Luz (Horno):</span>
                <span className="font-medium">${lightTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Mano de Obra:</span>
                <span className="font-medium">
                  ${parseFloat(laborCost || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-600 mt-2">
                <span className="font-bold text-gray-200">
                  Costo de Producción:
                </span>
                <span className="font-bold text-yellow-400">
                  ${productionCost.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="bg-green-500 bg-opacity-20 p-4 rounded-lg border border-green-500 text-center">
              <p className="text-green-300 text-sm mb-1">
                Precio Sugerido de Venta
              </p>
              <p className="text-3xl font-black text-white">
                ${suggestedPrice.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
