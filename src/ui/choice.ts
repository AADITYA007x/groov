// A bottom sheet with a few options (sleep timer, crossfade, storage...).
// Resolves with the chosen value, or null if dismissed.
import { escapeHtml } from "../utils";
import { pushStep, removeStep } from "./back";

export interface ChoiceOption<T> {
  label: string;
  value: T;
  active?: boolean;
  danger?: boolean;
}

let closeCurrent: (() => void) | null = null;

export function chooseOption<T>(title: string, options: ChoiceOption<T>[], note = ""): Promise<T | null> {
  closeCurrent?.();
  return new Promise((resolve) => {
    const sheet = document.createElement("div");
    sheet.className = "queue-sheet choice-sheet";
    sheet.innerHTML = `
      <div class="queue-panel choice-panel" role="dialog" aria-label="${escapeHtml(title)}">
        <div class="queue-header"><h2>${escapeHtml(title)}</h2></div>
        ${note ? `<div class="queue-now">${escapeHtml(note)}</div>` : ""}
        <div class="choice-list">
          ${options
            .map(
              (o, i) =>
                `<button class="choice-option${o.active ? " active" : ""}${o.danger ? " danger" : ""}" data-choice="${i}">
                   <span>${escapeHtml(o.label)}</span>${o.active ? "<span>✓</span>" : ""}
                 </button>`,
            )
            .join("")}
        </div>
      </div>`;
    const finish = (value: T | null) => {
      if (!sheet.isConnected) return;
      sheet.remove();
      removeStep("choice");
      closeCurrent = null;
      resolve(value);
    };
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) return finish(null);
      const btn = (e.target as Element).closest<HTMLElement>("[data-choice]");
      if (btn) finish(options[Number(btn.dataset.choice)].value);
    });
    document.body.appendChild(sheet);
    pushStep("choice", () => finish(null));
    closeCurrent = () => finish(null);
  });
}
