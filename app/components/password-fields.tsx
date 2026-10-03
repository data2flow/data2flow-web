/**
 * 새 비밀번호 + 확인 입력과 실시간 강도 표시(UI-IAM-02·03·04, BR-IAM-03).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { passwordStrength } from "~/lib/validation";
import { TextField } from "./ui";

export function passwordProblemText(t: (key: string) => string, problem: string | undefined): string | undefined {
  if (!problem) return undefined;
  if (problem === "mismatch") return t("validation.passwordMismatch");
  if (problem === "required") return t("validation.passwordRequired");
  return `${t("validation.passwordPolicy")}: ${t(`validation.passwordReason.${problem}`)}`;
}

export function PasswordFields({ name, problem, autoComplete = "new-password" }: { name: string; problem?: string; autoComplete?: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const strength = passwordStrength(value);
  const mismatch = problem === "mismatch";
  return (
    <>
      <TextField
        label={t("password.new")}
        name={name}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        hint={t("password.rule")}
        error={!mismatch ? passwordProblemText(t, problem) : undefined}
      />
      <div className="flex items-center gap-2 text-[12px] text-muted" aria-live="polite">
        <span>{t("password.strength")}</span>
        <span className="flex gap-0.5" aria-hidden="true">
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={`h-1.5 w-6 rounded ${strength >= step ? "bg-accent" : "bg-line"}`} />
          ))}
        </span>
        <span>{t(`password.level.${strength}`)}</span>
      </div>
      <TextField
        label={t("password.confirm")}
        name="confirmPassword"
        type="password"
        autoComplete={autoComplete}
        error={mismatch ? passwordProblemText(t, problem) : undefined}
      />
    </>
  );
}
