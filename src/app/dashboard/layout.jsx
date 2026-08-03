"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase";

const navigation = [
  { href: "/dashboard", label: "Inicio", icon: "⌂" },
  { href: "/dashboard/inventario", label: "Inventario", icon: "▦" },
  { href: "/dashboard/recetas", label: "Recetas", icon: "▤" },
  { href: "/dashboard/configuracion", label: "Configuración", icon: "⚙" },
];

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href) =>
    href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  const handleLogout = async () => {
    const result = await Swal.fire({
      icon: "question",
      title: "¿Cerrar sesión?",
      text: "Tendrás que iniciar sesión nuevamente para entrar al panel.",
      showCancelButton: true,
      confirmButtonText: "Sí, cerrar sesión",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#8b5e3c",
      cancelButtonColor: "#78716c",
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    const { error } = await supabase.auth.signOut();
    if (error) {
      await Swal.fire({ icon: "error", title: "No se pudo cerrar sesión", text: error.message });
      return;
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#f7f5f2]">
      {mobileOpen && (
        <button aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-stone-950/35 backdrop-blur-sm lg:hidden" />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-stone-200 bg-white transition-transform duration-300 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between border-b border-stone-100 px-6">
          <Link href="/dashboard" onClick={() => setMobileOpen(false)} className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-100 text-xl">🍪</span>
            <div>
              <p className="font-black leading-tight text-stone-900">Mi Negocio</p>
              <p className="text-xs font-medium text-stone-400">Costos y recetas</p>
            </div>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 lg:hidden">✕</button>
        </div>

        <nav className="app-scrollbar flex-1 space-y-1 overflow-y-auto p-4">
          <p className="mb-3 px-3 text-xs font-black uppercase tracking-[.16em] text-stone-400">Menú principal</p>
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition ${isActive(item.href) ? "bg-[#3b2a20] text-white shadow-md shadow-stone-900/10" : "text-stone-600 hover:bg-orange-50 hover:text-orange-900"}`}>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg ${isActive(item.href) ? "bg-white/10" : "bg-stone-100"}`}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-stone-100 p-4">
          <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold text-red-600 transition hover:bg-red-50">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100">↪</span>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-stone-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xl text-stone-700 shadow-sm lg:hidden">☰</button>
            <div>
              <p className="text-xs font-bold uppercase tracking-[.15em] text-orange-700">Panel administrativo</p>
              <p className="hidden text-sm text-stone-500 sm:block">Gestiona tu producción con información clara.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-stone-200 bg-white py-1.5 pl-3 pr-1.5 shadow-sm">
            <span className="hidden text-sm font-bold text-stone-700 sm:block">Administradora</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 font-black text-orange-800">A</span>
          </div>
        </header>

        <main className="app-scrollbar min-h-[calc(100vh-5rem)] p-4 sm:p-7 lg:p-9">{children}</main>
      </div>
    </div>
  );
}
