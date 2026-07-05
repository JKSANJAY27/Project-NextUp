import React from "react";
import { Check } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  previewColor: string;
}

interface ResumeTemplateSelectorProps {
  selectedTemplate: string;
  onSelectTemplate: (templateId: string) => void;
}

const TEMPLATES: Template[] = [
  {
    id: "Classic",
    name: "Classic Academic",
    description: "Traditional single-column layout. High density, clean spacing, optimized for standard corporate and engineering applications.",
    previewColor: "bg-slate-700"
  },
  {
    id: "Modern",
    name: "Modern Professional",
    description: "Sleek sans-serif typography, subtle colored accents, and distinct section breaks. Excellent for modern tech companies.",
    previewColor: "bg-indigo-600"
  },
  {
    id: "Minimalist",
    name: "Minimalist Clean",
    description: "Ultra-clean layout utilizing generous whitespace, light lines, and elegant hierarchy. Best for design or product roles.",
    previewColor: "bg-emerald-600"
  }
];

export default function ResumeTemplateSelector({
  selectedTemplate,
  onSelectTemplate
}: ResumeTemplateSelectorProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold tracking-wider uppercase text-muted-foreground mb-1">
          Select LaTeX Template
        </h3>
        <p className="text-xs text-muted-foreground">
          Choose a pre-defined styling skeleton. The AI only handles text optimizations; the layout is compiled deterministically.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TEMPLATES.map((tmpl) => {
          const isSelected = selectedTemplate === tmpl.id;
          return (
            <button
              key={tmpl.id}
              onClick={() => onSelectTemplate(tmpl.id)}
              className={`text-left p-4 rounded-xl border-2 transition-all duration-300 relative overflow-hidden group ${
                isSelected
                  ? "border-accent bg-accent/5 shadow-[0_0_20px_rgba(var(--accent-rgb),0.15)]"
                  : "border-border hover:border-muted-foreground/30 bg-card/40"
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className={`w-10 h-6 rounded ${tmpl.previewColor} opacity-70 group-hover:opacity-100 transition-opacity`} />
                {isSelected && (
                  <span className="bg-accent text-accent-foreground p-1 rounded-full text-xs">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>

              <h4 className="font-mono text-sm font-bold tracking-tight mb-1">
                {tmpl.name}
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {tmpl.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
