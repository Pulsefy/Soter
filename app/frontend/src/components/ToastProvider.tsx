"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastContextType {
  toast: (title: string, description?: string, type?: ToastType) => void;
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<ToastType>("info");

  const toast = React.useCallback(
    (t: string, d?: string, ty: ToastType = "info") => {
      setTitle(t);
      setDescription(d || "");
      setType(ty);
      setOpen(false); // reset
      setTimeout(() => setOpen(true), 10);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        <ToastPrimitive.Root
          open={open}
          onOpenChange={setOpen}
          className={`bg-white rounded-md shadow-lg p-4 border fixed bottom-4 right-4 z-50 w-80 transform transition-transform duration-300 ease-in-out data-[state=open]:translate-x-0 data-[state=closed]:translate-x-[110%] ${
            type === "error" ? "border-red-500" : type === "success" ? "border-green-500" : type === "warning" ? "border-yellow-500" : "border-gray-200"
          }`}
        >
          <div className="flex flex-col gap-1">
            <ToastPrimitive.Title className={`text-sm font-semibold ${type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-600' : type === 'warning' ? 'text-yellow-600' : 'text-gray-900'}`}>
              {title}
            </ToastPrimitive.Title>
            {description && (
              <ToastPrimitive.Description className="text-sm text-gray-500">
                {description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-900 focus:outline-none">
            <span aria-hidden>×</span>
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 p-[var(--viewport-padding)] w-[390px] max-w-[100vw] z-[2147483647]" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
};
