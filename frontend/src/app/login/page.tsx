"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useLogin, useChangePassword } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/form";
import { AxiosError } from "axios";

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const changePasswordSchema = z.object({
  new_password: z.string().min(8, "Minimum 8 characters").regex(/[A-Z]/, "Must contain an uppercase letter").regex(/\d/, "Must contain a number"),
  confirm_password: z.string(),
}).refine((d) => d.new_password === d.confirm_password, { message: "Passwords don't match", path: ["confirm_password"] });

type LoginValues = z.infer<typeof loginSchema>;
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export default function LoginPage() {
  const login = useLogin();
  const changePassword = useChangePassword();
  const [mustChange, setMustChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const changeForm = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  const onLogin = (values: LoginValues) => {
    login.mutate(values, {
      onSuccess: (data) => {
        if (data.must_change_password) {
          setCurrentPassword(values.password);
          setMustChange(true);
        }
      },
    });
  };

  const onChangePassword = (values: ChangePasswordValues) => {
    changePassword.mutate({ current_password: currentPassword, new_password: values.new_password });
  };

  const loginError = login.error as AxiosError<{ detail: string }> | null;
  const errorMessage = loginError?.response?.data?.detail || (login.isError ? "Invalid email or password" : null);

  const { setTheme, theme } = useTheme();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden">
      {/* Theme toggle */}
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </button>
      {/* Background pattern */}
      <div
        className="absolute inset-0 hidden dark:block"
        style={{ backgroundImage: "url('/login-bg.svg')", backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div
        className="absolute inset-0 block dark:hidden"
        style={{ backgroundImage: "url('/login-bg-light.svg')", backgroundSize: "cover", backgroundPosition: "center" }}
      />

      <div className="relative w-full max-w-sm space-y-6 rounded-lg border border-border bg-card/95 backdrop-blur-sm p-8 shadow-lg">
        <div className="flex justify-center">
          <Image src="/logo.svg" alt="QTC360" width={140} height={28} className="hidden dark:block" style={{ height: "auto" }} />
          <Image src="/logo-light.svg" alt="QTC360" width={140} height={28} className="block dark:hidden" style={{ height: "auto" }} />
        </div>

        {!mustChange ? (
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(onLogin)} noValidate className="space-y-4">
              <FormField control={loginForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="you@company.com" autoComplete="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={loginForm.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
              <Button type="submit" className="w-full h-11" disabled={login.isPending}>
                {login.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Form>
        ) : (
          <>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Password Change Required</p>
              <p className="text-xs text-muted-foreground">Please set a new password to continue</p>
            </div>
            <Form {...changeForm}>
              <form onSubmit={changeForm.handleSubmit(onChangePassword)} noValidate className="space-y-4">
                <FormField control={changeForm.control} name="new_password" render={({ field }) => (
                  <FormItem><FormLabel>New Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={changeForm.control} name="confirm_password" render={({ field }) => (
                  <FormItem><FormLabel>Confirm Password</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                {changePassword.isError && <p className="text-sm text-destructive">Failed to change password</p>}
                <p className="text-xs text-muted-foreground">Min 8 characters, 1 uppercase, 1 number</p>
                <Button type="submit" className="w-full h-11" disabled={changePassword.isPending}>
                  {changePassword.isPending ? "Saving…" : "Change Password"}
                </Button>
              </form>
            </Form>
          </>
        )}
      </div>
      <p className="absolute bottom-6 text-[11px] tracking-wider text-muted-foreground/40 z-10">
        Proudly by LB
      </p>
    </div>
  );
}
