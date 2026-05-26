"use client";

import * as React from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);
  return { name: fieldContext.name, ...fieldState };
}

function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label className={className} {...props} />;
}

function FormControl({ ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { error, name } = useFormField();
  return <div id={name} aria-invalid={!!error} aria-describedby={error ? `${name}-message` : undefined} {...props} />;
}

function FormMessage({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { error, name } = useFormField();
  if (!error?.message) return null;
  return (
    <p id={`${name}-message`} className={cn("text-sm text-destructive", className)} {...props}>
      {error.message}
    </p>
  );
}

function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { name } = useFormField();
  return <p id={`${name}-description`} className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription, useFormField };
