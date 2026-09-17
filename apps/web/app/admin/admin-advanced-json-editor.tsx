"use client";

import React from "react";

interface AdminAdvancedJsonEditorProps {
  label: string;
  help: string;
  placeholder: string;
  value: string;
  inputClass: string;
  onChange: (value: string) => void;
}

export function AdminAdvancedJsonEditor({
  label,
  help,
  placeholder,
  value,
  inputClass,
  onChange
}: AdminAdvancedJsonEditorProps) {
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">
        {label}
      </summary>
      <div className="mt-3 grid gap-2">
        <textarea
          className={`${inputClass} min-h-32 font-mono text-xs leading-6`}
          placeholder={placeholder}
          rows={5}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <p className="text-xs leading-5 text-slate-500">{help}</p>
      </div>
    </details>
  );
}
