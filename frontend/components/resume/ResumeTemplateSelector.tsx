import React from "react";
import { Check } from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
}

interface ResumeTemplateSelectorProps {
  selectedTemplate: string;
  onSelectTemplate: (templateId: string) => void;
}

const TEMPLATES: Template[] = [
  {
    id: "Classic",
    name: "Classic Academic",
    description: "Traditional single-column layout. High density, clean spacing, optimized for standard corporate and engineering applications."
  },
  {
    id: "Modern",
    name: "Modern Professional",
    description: "Sleek sans-serif typography, subtle colored accents, and distinct section breaks. Excellent for modern tech companies."
  },
  {
    id: "Minimalist",
    name: "Minimalist Clean",
    description: "Ultra-clean layout utilizing generous whitespace, light lines, and elegant hierarchy. Best for design or product roles."
  }
];

/** Mini mock "page" approximating how each LaTeX template lays out a resume.
 *  Pure CSS — always rendered on a white sheet like the compiled PDF. */
function TemplatePreview({ templateId }: { templateId: string }) {
  const Line = ({ w, h = 3, className = "" }: { w: string; h?: number; className?: string }) => (
    <div className={`rounded-sm ${className}`} style={{ width: w, height: h }} />
  );

  if (templateId === "Classic") {
    return (
      <div className="bg-white rounded-md p-2.5 aspect-[3/4] flex flex-col gap-1.5 shadow-inner overflow-hidden">
        {/* Centered serif-style header */}
        <div className="flex flex-col items-center gap-1">
          <Line w="55%" h={5} className="bg-slate-800" />
          <Line w="70%" h={2} className="bg-slate-400" />
        </div>
        <div className="border-t border-slate-300 mt-1" />
        {/* Dense single-column sections */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <Line w="35%" h={3.5} className="bg-slate-700" />
            <Line w="100%" h={2} className="bg-slate-300" />
            <Line w="95%" h={2} className="bg-slate-300" />
            <Line w="85%" h={2} className="bg-slate-300" />
          </div>
        ))}
      </div>
    );
  }

  if (templateId === "Modern") {
    return (
      <div className="bg-white rounded-md aspect-[3/4] flex overflow-hidden shadow-inner">
        {/* Colored accent rail */}
        <div className="w-1.5 bg-indigo-600 shrink-0" />
        <div className="flex-1 p-2.5 flex flex-col gap-1.5">
          <Line w="60%" h={5} className="bg-slate-800" />
          <Line w="40%" h={2.5} className="bg-indigo-500" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                <Line w="40%" h={3.5} className="bg-indigo-700" />
              </div>
              <Line w="100%" h={2} className="bg-slate-300" />
              <Line w="90%" h={2} className="bg-slate-300" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Minimalist
  return (
    <div className="bg-white rounded-md p-3 aspect-[3/4] flex flex-col gap-2.5 shadow-inner overflow-hidden">
      <Line w="45%" h={5} className="bg-slate-700" />
      <Line w="30%" h={2} className="bg-slate-400" />
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 mt-1.5">
          <Line w="28%" h={2.5} className="bg-emerald-600" />
          <div className="border-t border-slate-200" />
          <Line w="90%" h={2} className="bg-slate-200" />
          <Line w="75%" h={2} className="bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

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
              className={`text-left p-3 rounded-xl border-2 transition-all duration-300 relative overflow-hidden group ${
                isSelected
                  ? "border-accent bg-accent/5 shadow-[0_0_20px_rgba(var(--accent-rgb),0.15)]"
                  : "border-border hover:border-muted-foreground/30 bg-card/40"
              }`}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 z-10 bg-accent text-accent-foreground p-1 rounded-full text-xs">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}

              {/* Layout preview */}
              <div className="mb-3 opacity-90 group-hover:opacity-100 transition-opacity">
                <TemplatePreview templateId={tmpl.id} />
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
