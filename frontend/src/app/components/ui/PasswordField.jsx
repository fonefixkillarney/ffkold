"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

// A password input with a show/hide eye, shared by every sign-in / sign-up form
// so the toggle behaves identically in all of them.
//
// `className` goes on the <input> (each form keeps its own field styling) and any
// other prop is forwarded straight through — value/onChange/required/minLength/
// autoComplete all stay the caller's business. The wrapper only owns the eye.
//
// `labelClassName` and `toggleClassName` are overridable because the forms no
// longer all sit on the same surface. The defaults now target the GLASS cards
// the sign-up / reset screens use — they used to be `dark:text-black`, which
// only worked while those cards were a solid cyan slab and is invisible on a
// translucent one. The admin login sits on the dashboard's opaque panel and
// passes its own `panel-*` pair, so it is unaffected by this default.
export default function PasswordField({
  id,
  label = "Password",
  className = "",
  labelClassName = "glass-strong mb-1 block text-sm font-medium",
  toggleClassName = "glass-muted hover:text-primary-dark dark:hover:text-primary",
  ...inputProps
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      {label && (
        <label htmlFor={id} className={labelClassName}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          // The whole point: flipping to "text" is what reveals the password.
          type={visible ? "text" : "password"}
          // pr-10 keeps the typed value from running under the eye button.
          className={`${className} pr-10`}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
          className={`absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 transition-colors duration-150 ${toggleClassName}`}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
}
