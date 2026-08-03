// app/dashboard/recetas/[id]/page.js
"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// IMPORTAMOS LAS LIBRERÍAS DE PDF
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import Swal from "sweetalert2";

export default function DetalleRecetaPage() {
  const { id } = useParams();
  const router = useRouter();

  // Referencia al contenedor que vamos a convertir a PDF
  const printRef = useRef();

  const [recipe, setRecipe] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [steps, setSteps] = useState([]);
  const [kwhCost, setKwhCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;

    async function loadRecipeData() {
      try {
        const [configResponse, recipeResponse, ingredientsResponse, stepsResponse] = await Promise.all([
          supabase.from("app_config").select("kwh_cost").limit(1).maybeSingle(),
          supabase.from("recipes").select("*").eq("id", id).single(),
          supabase.from("recipe_ingredients").select(`quantity_needed, ingredients ( name, unit, purchase_cost, purchase_quantity )`).eq("recipe_id", id),
          supabase.from("recipe_steps").select("*").eq("recipe_id", id).order("step_number", { ascending: true }),
        ]);

        if (recipeResponse.error) throw recipeResponse.error;
        if (ingredientsResponse.error) throw ingredientsResponse.error;
        if (stepsResponse.error) throw stepsResponse.error;
        if (!active) return;

        setKwhCost(Number(configResponse.data?.kwh_cost) || 0);
        setRecipe(recipeResponse.data);
        setIngredients(ingredientsResponse.data ?? []);
        setSteps(stepsResponse.data ?? []);
      } catch (error) {
        console.error("Error cargando la receta:", error);
        if (active) {
          await Swal.fire({ icon: "error", title: "No se pudo cargar la receta", text: error.message, confirmButtonColor: "#8b5e3c" });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadRecipeData();
    return () => { active = false; };
  }, [id]);

  // --- LA MAGIA DEL PDF ---
  const handleExportPDF = async () => {
    setIsExporting(true);
    const element = printRef.current;

    try {
      // html2canvas toma una foto del contenedor
      const canvas = await html2canvas(element, {
        scale: 2, // Mayor calidad
        useCORS: true,
        backgroundColor: "#ffffff", // Fondo blanco para el PDF
      });

      const imgData = canvas.toDataURL("image/png");

      // jsPDF crea el documento (formato A4)
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Receta_${recipe.name.replace(/\s+/g, "_")}.pdf`);

      Swal.fire({
        icon: "success",
        title: "¡PDF Creado!",
        text: "Tu receta se ha descargado correctamente.",
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Hubo un problema al generar el PDF.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (loading)
    return (
      <div className="text-center py-20 text-gray-500 font-medium">
        Cargando receta...
      </div>
    );
  if (!recipe)
    return (
      <div className="text-center py-20 text-red-500 font-medium">
        Receta no encontrada.
      </div>
    );

  const insumosTotal = ingredients.reduce((sum, item) => {
    const unitCost =
      item.ingredients.purchase_cost / item.ingredients.purchase_quantity;
    return sum + unitCost * item.quantity_needed;
  }, 0);

  const lightTotal = (recipe.oven_time_minutes / 60) * kwhCost;
  const productionCost = insumosTotal + lightTotal + recipe.labor_cost;
  const suggestedPrice =
    productionCost + productionCost * (recipe.profit_margin_percent / 100);

  return (
    <div className="mx-auto max-w-6xl pb-10">
      {/* HEADER DE BOTONES */}
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={() => router.back()}
          className="text-gray-600 hover:text-gray-900 font-medium"
        >
          ← Volver
        </button>
        <button
          onClick={handleExportPDF}
          disabled={isExporting}
          className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-red-700 transition flex items-center gap-2 disabled:opacity-50"
        >
          {isExporting ? "Generando..." : "📄 Descargar PDF"}
        </button>
      </div>

      {/* CONTENEDOR A EXPORTAR (Le asignamos la ref) */}
      <div
        ref={printRef}
        className="bg-white p-8 rounded-xl shadow-sm border border-gray-200"
      >
        <div className="border-b border-gray-200 pb-4 mb-6">
          <h1 className="text-3xl font-bold text-gray-800">{recipe.name}</h1>
          <p className="text-sm text-gray-500 mt-2">
            Tiempo de horno estimado: {recipe.oven_time_minutes} minutos
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <section>
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                🛒 Ingredientes
              </h2>
              <ul className="space-y-3">
                {ingredients.map((item, idx) => {
                  const unitCost =
                    item.ingredients.purchase_cost /
                    item.ingredients.purchase_quantity;
                  const itemCost = unitCost * item.quantity_needed;
                  return (
                    <li
                      key={idx}
                      className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100"
                    >
                      <span className="font-medium text-gray-700">
                        {item.quantity_needed} {item.ingredients.unit} de{" "}
                        {item.ingredients.name}
                      </span>
                      <span className="text-gray-500 text-sm">
                        ${itemCost.toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                📖 Preparación
              </h2>
              <div className="space-y-4">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-700 font-bold rounded-full flex items-center justify-center">
                      {step.step_number}
                    </div>
                    <p className="text-gray-700 pt-1">{step.description}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div>
            <div className="rounded-2xl bg-[#3b2a20] p-6 text-white shadow-xl">
              <h3 className="text-lg font-bold border-b border-gray-600 pb-2 mb-4">
                💰 Desglose Financiero
              </h3>

              <div className="space-y-2 text-sm mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-300">Total en Insumos:</span>
                  <span className="font-medium">
                    ${insumosTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Luz (Horno):</span>
                  <span className="font-medium">${lightTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Mano de Obra:</span>
                  <span className="font-medium">
                    ${recipe.labor_cost.toFixed(2)}
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
                  Precio Sugerido de Venta (Margen{" "}
                  {recipe.profit_margin_percent}%)
                </p>
                <p className="text-3xl font-black text-white">
                  ${suggestedPrice.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
