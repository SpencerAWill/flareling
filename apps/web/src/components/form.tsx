/**
 * The app's forms, on TanStack Form: `useAppForm` with the field and form
 * components below, so every form gets the same label, error and
 * accessibility wiring, and the same submit button behavior.
 *
 *   const form = useAppForm({
 *     defaultValues: { email: "" },
 *     validators: { onChange: signInSchema }, // src/lib/schemas.ts
 *     onSubmit: async ({ value }) => { ... },
 *   });
 *   <Form form={form}>
 *     <form.AppField name="email">
 *       {(field) => <field.TextField label="Email" type="email" />}
 *     </form.AppField>
 *     <form.AppForm>
 *       <form.SubmitButton>Send</form.SubmitButton>
 *     </form.AppForm>
 *   </Form>
 *
 * A field's errors show once it has lost focus, or after a submit attempt,
 * not on the first keystroke.
 */
import {
  Button,
  type ButtonProps,
  cn,
  Input,
  Label,
  NativeSelect,
} from "@flareling/ui";
import {
  createFormHook,
  createFormHookContexts,
  useStore,
} from "@tanstack/react-form";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useId,
} from "react";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

/** The first error to show for the current field, or undefined. */
function useFieldError(): string | undefined {
  const field = useFieldContext<unknown>();
  const attempted = useStore(
    field.form.store,
    (state) => state.submissionAttempts > 0,
  );
  const { errors, isBlurred } = field.state.meta;
  if (!(isBlurred || attempted)) return undefined;
  for (const error of errors) {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      return String(error.message);
    }
  }
  return undefined;
}

/** A labelled field: the control, then its error, tied together for AT. */
function FieldShell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string | undefined;
  children: (control: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const error = useFieldError();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": error ? errorId : undefined,
      })}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function TextField({
  label,
  className,
  ...props
}: { label: string; className?: string | undefined } & Omit<
  ComponentProps<"input">,
  "id" | "name" | "value" | "onChange" | "onBlur" | "className"
>) {
  const field = useFieldContext<string>();
  return (
    <FieldShell label={label} className={className}>
      {(control) => (
        <Input
          {...props}
          {...control}
          name={field.name}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        />
      )}
    </FieldShell>
  );
}

function SelectField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  const field = useFieldContext<string>();
  return (
    <FieldShell label={label} className={className}>
      {(control) => (
        <NativeSelect
          {...control}
          name={field.name}
          value={field.state.value}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        >
          {children}
        </NativeSelect>
      )}
    </FieldShell>
  );
}

/**
 * The form's submit button: disabled while submitting, and once a submit
 * attempt has shown errors, until they're fixed.
 */
function SubmitButton({ disabled, ...props }: Omit<ButtonProps, "type">) {
  const form = useFormContext();
  const [canSubmit, isSubmitting] = useStore(form.store, (state) => [
    state.canSubmit,
    state.isSubmitting,
  ]);
  return (
    <Button
      {...props}
      type="submit"
      disabled={disabled || !canSubmit || isSubmitting}
    />
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, SelectField },
  formComponents: { SubmitButton },
});

/**
 * A `<form>` that hands submission to TanStack Form. noValidate: the
 * schema's messages replace the browser's, and are the same everywhere.
 */
export function Form({
  form,
  className,
  children,
}: {
  form: { handleSubmit: () => Promise<unknown> };
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      noValidate
      className={className}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {children}
    </form>
  );
}
