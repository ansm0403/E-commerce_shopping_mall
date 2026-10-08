"use client";

import React from "react";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  useForm,
  FormProvider,
  useFormContext,
  type FieldValues,
  type SubmitHandler,
  type Resolver,
  type Path,
  type DefaultValues,
} from "react-hook-form";

/* =========================
 *  공통 인풋 베이스 클래스
 * ========================= */

const INPUT_BASE =
  "px-2.5 py-2 rounded-md border border-gray-300 text-sm outline-none bg-white" +
  " transition-[border-color,box-shadow] duration-150" +
  " focus:border-primary-600 focus:ring-1 focus:ring-primary-600/20";

/* =========================
 *  Form Root variants (cva)
 * ========================= */

const formVariants = cva(
  "max-w-[520px] w-full flex flex-col gap-6 p-6 sm:p-8 rounded-3xl border border-primary-100 bg-white",
  {
    variants: {
      variant: {
        default: "",
        login:   "max-w-[440px] mt-6 mx-auto mb-[10px]",
        signup:  "mt-6 mx-auto mb-10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

/* =========================
 *  Form Root
 * ========================= */

export type FormProps<T extends FieldValues> = {
  title?: string;
  description?: string;
  submitLabel?: string;
  defaultValues: DefaultValues<T>;
  onSubmit: SubmitHandler<T>;
  resolver?: Resolver<T>;
  variant?: "login" | "signup" | "default";
  /** 폼 카드에 덧씌울 클래스 — 기본 폭(520px)을 넓힐 때(`max-w-[960px] mx-auto`) */
  className?: string;
  /** 필드 묶음에 덧씌울 클래스 — 기본은 세로 한 줄, 여러 단으로 펼칠 때 grid 를 준다 */
  bodyClassName?: string;
  children: React.ReactNode;
};

export function Form<T extends FieldValues>({
  title,
  description,
  submitLabel = "저장",
  defaultValues,
  onSubmit,
  resolver,
  variant = "default",
  className,
  bodyClassName,
  children,
}: FormProps<T>) {
  const methods = useForm<T>({
    defaultValues,
    resolver,
    mode: "onSubmit",
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  return (
    <FormProvider {...methods}>
      <form
        className={twMerge(clsx(formVariants({ variant }), className))}
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        {(title || description) && (
          <div className="flex flex-col gap-1">
            {title && <h1 className="text-xl font-bold">{title}</h1>}
            {description && <p className="text-[13px] text-gray-500">{description}</p>}
          </div>
        )}

        <div className={twMerge(clsx("flex flex-col gap-5", bodyClassName))}>{children}</div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={twMerge(clsx(
            "mt-1 px-3 py-2.5 rounded-[10px] border-0 text-sm font-semibold text-white cursor-pointer",
            "bg-primary-600 transition-[background-color,transform,box-shadow] duration-150",
            "hover:bg-primary-700 hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(0,0,0,0.12)]",
            "active:translate-y-0 active:shadow-none",
            "disabled:bg-gray-400 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0"
          ))}
        >
          {isSubmitting ? "처리 중..." : submitLabel}
        </button>
      </form>
    </FormProvider>
  );
}

/* =========================
 *  필드 컴포넌트들
 * ========================= */

/**
 * 도움말·에러 문구를 입력칸에 연결한다. 예전엔 문구가 화면에만 있고 입력칸과 끊겨 있어,
 * 제출 실패 시 react-hook-form 이 틀린 칸으로 포커스를 옮겨도 스크린리더는 label 만 읽고 "왜 틀렸는지"를 못 읽었다.
 */
function fieldA11y(name: string, helperText?: string, message?: string) {
  const ids = [helperText && `${name}-help`, message && `${name}-error`].filter(Boolean).join(' ');
  return {
    'aria-invalid': message ? true : undefined,
    'aria-describedby': ids || undefined,
  } as const;
}

type BaseFieldProps<T extends FieldValues> = {
  name: Path<T>;
  label?: string;
  helperText?: string;
};

/** Text / Email / Password 등 기본 인풋 */
export type TextFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  type?: React.InputHTMLAttributes<HTMLInputElement>["type"];
  placeholder?: string;
};

export function TextField<T extends FieldValues>({
  name,
  label,
  helperText,
  type = "text",
  placeholder,
}: TextFieldProps<T>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const error = errors[name] as any;
  const message: string | undefined = error?.message;

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <label htmlFor={name} className="text-[13px] font-medium">
          {label}
        </label>
      )}
      {helperText && <p id={`${name}-help`} className="text-xs text-gray-500">{helperText}</p>}
      <input
        id={name}
        type={type}
        placeholder={placeholder}
        className={INPUT_BASE}
        {...fieldA11y(name, helperText, message)}
        {...register(name)}
      />
      {message && <span id={`${name}-error`} className="text-xs text-red-600">{message}</span>}
    </div>
  );
}

/** Textarea */
export type TextareaFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  placeholder?: string;
  rows?: number;
};

export function TextareaField<T extends FieldValues>({
  name,
  label,
  helperText,
  placeholder,
  rows = 4,
}: TextareaFieldProps<T>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const error = errors[name] as any;
  const message: string | undefined = error?.message;

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <label htmlFor={name} className="text-[13px] font-medium">
          {label}
        </label>
      )}
      {helperText && <p id={`${name}-help`} className="text-xs text-gray-500">{helperText}</p>}
      <textarea
        id={name}
        placeholder={placeholder}
        rows={rows}
        className={twMerge(clsx(INPUT_BASE, "min-h-[80px] resize-y"))}
        {...fieldA11y(name, helperText, message)}
        {...register(name)}
      />
      {message && <span id={`${name}-error`} className="text-xs text-red-600">{message}</span>}
    </div>
  );
}

/** Select */
export type SelectOption = {
  label: string;
  value: string;
};

export type SelectFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  options: SelectOption[];
  placeholder?: string;
};

export function SelectField<T extends FieldValues>({
  name,
  label,
  helperText,
  options,
  placeholder,
}: SelectFieldProps<T>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const error = errors[name] as any;
  const message: string | undefined = error?.message;

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <label htmlFor={name} className="text-[13px] font-medium">
          {label}
        </label>
      )}
      {helperText && <p id={`${name}-help`} className="text-xs text-gray-500">{helperText}</p>}
      <select id={name} className={INPUT_BASE} {...fieldA11y(name, helperText, message)} {...register(name)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {message && <span id={`${name}-error`} className="text-xs text-red-600">{message}</span>}
    </div>
  );
}

/** Checkbox */
export type CheckboxFieldProps<T extends FieldValues> = {
  name: Path<T>;
  children: React.ReactNode;
  helperText?: string;
};

export function CheckboxField<T extends FieldValues>({
  name,
  children,
  helperText,
}: CheckboxFieldProps<T>) {
  const {
    register,
    formState: { errors },
  } = useFormContext<T>();

  const error = errors[name] as any;
  const message: string | undefined = error?.message;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" {...fieldA11y(name, helperText, message)} {...register(name)} />
        {children}
      </label>
      {helperText && <p id={`${name}-help`} className="text-xs text-gray-500">{helperText}</p>}
      {message && <span id={`${name}-error`} className="text-xs text-red-600">{message}</span>}
    </div>
  );
}
