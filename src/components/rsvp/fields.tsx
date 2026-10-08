"use client";
import { Check, Heart, HelpCircle, Minus, Plus, X } from "lucide-react";
import { attendanceLabels, type Attendance } from "@/lib/event";
import { Button } from "@/components/ui/button";
export type FormValues = {
  fullName: string;
  attendance: Attendance | "";
  guestCount: number;
};
export const emptyForm: FormValues = {
  fullName: "",
  attendance: "",
  guestCount: 1,
};

export function RsvpFields({
  value,
  onChange,
  disabled = false,
}: {
  value: FormValues;
  onChange: (v: FormValues) => void;
  disabled?: boolean;
}) {
  const icons = { yes: Check, no: X, maybe: HelpCircle };
  return (
    <fieldset disabled={disabled} className="fields">
      <div className="field">
        <label htmlFor="full-name">
          שם מלא <span aria-hidden="true">*</span>
        </label>
        <input
          id="full-name"
          name="fullName"
          autoComplete="name"
          placeholder="איך קוראים לכם?"
          required
          minLength={2}
          maxLength={100}
          value={value.fullName}
          onChange={(e) => onChange({ ...value, fullName: e.target.value })}
        />
      </div>
      <fieldset className="attendance-field">
        <legend>
          תצטרפו אלינו? <span aria-hidden="true">*</span>
        </legend>
        <div className="attendance-options">
          {(["yes", "maybe", "no"] as Attendance[]).map((status) => {
            const Icon = icons[status];
            return (
              <label
                key={status}
                className={`attendance-option ${value.attendance === status ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="attendance"
                  value={status}
                  required
                  checked={value.attendance === status}
                  onChange={() => onChange({ ...value, attendance: status })}
                />
                <Icon size={22} aria-hidden="true" />
                <span>{attendanceLabels[status]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {value.attendance === "yes" && (
        <div className="field count-field">
          <label htmlFor="guest-count">כמה תהיו?</label>
          <div className="stepper">
            <Button
              variant="outline"
              type="button"
              aria-label="הפחתת משתתף"
              disabled={disabled || value.guestCount <= 1}
              onClick={() =>
                onChange({
                  ...value,
                  guestCount: Math.max(1, value.guestCount - 1),
                })
              }
            >
              <Minus size={18} />
            </Button>
            <input
              id="guest-count"
              name="guestCount"
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              required
              value={value.guestCount}
              onChange={(e) =>
                onChange({ ...value, guestCount: Number(e.target.value) })
              }
            />
            <Button
              variant="outline"
              type="button"
              aria-label="הוספת משתתף"
              disabled={disabled || value.guestCount >= 20}
              onClick={() =>
                onChange({
                  ...value,
                  guestCount: Math.min(20, value.guestCount + 1),
                })
              }
            >
              <Plus size={18} />
            </Button>
          </div>
          <p className="field-note">
            <Heart size={13} aria-hidden="true" /> כולל ילדים וכל מי שמגיע איתכם
          </p>
        </div>
      )}
    </fieldset>
  );
}
