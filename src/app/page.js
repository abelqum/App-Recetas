"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event) => {
    event.preventDefault();
    if (loading) return;

    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      await Swal.fire({
        icon: "success",
        title: "Bienvenida",
        text: "Sesión iniciada correctamente.",
        timer: 1200,
        showConfirmButton: false,
      });
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Error al iniciar sesión:", error);
      await Swal.fire({
        icon: "error",
        title: "No pudimos iniciar sesión",
        text: "Revisa tu correo y contraseña e inténtalo nuevamente.",
        confirmButtonColor: "#8b5e3c",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-orange-200/35 blur-3xl" />
      <div className="absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-amber-100/70 blur-3xl" />

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_30px_80px_rgba(68,45,30,.14)] lg:grid-cols-[1.08fr_.92fr]">
        <div className="hidden min-h-[620px] flex-col justify-between bg-[#3b2a20] p-12 text-white lg:flex">
          <div>
            <div className="mb-12 inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-300" />
              Gestión para repostería
            </div>
            <h1 className="max-w-md text-5xl font-black leading-[1.05] tracking-tight">
              Tus recetas, costos e inventario en un solo lugar.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-stone-300">
              Controla insumos, calcula el costo real de producción y define precios con mayor seguridad.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm text-stone-200">
            {["Inventario", "Recetas", "Costos"].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">{item}</div>
            ))}
          </div>
        </div>

        <div className="flex min-h-[620px] items-center p-7 sm:p-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-9">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-2xl shadow-sm">🍪</div>
              <p className="text-sm font-bold uppercase tracking-[.18em] text-orange-700">Mi negocio</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-900">Iniciar sesión</h2>
              <p className="mt-3 leading-6 text-stone-500">Accede al panel para administrar tus recetas y costos.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-bold text-stone-700">Correo electrónico</label>
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-stone-900 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" />
              </div>
              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-bold text-stone-700">Contraseña</label>
                <div className="relative">
                  <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Tu contraseña" className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 pr-20 text-stone-900 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-4 focus:ring-orange-100" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-bold text-stone-500 hover:bg-stone-200 hover:text-stone-800">{showPassword ? "Ocultar" : "Mostrar"}</button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-xl bg-[#8b5e3c] px-5 py-3.5 font-bold text-white shadow-lg shadow-orange-900/15 transition hover:-translate-y-0.5 hover:bg-[#70472d] disabled:cursor-not-allowed disabled:opacity-60">
                {loading ? "Iniciando sesión..." : "Entrar al sistema"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
