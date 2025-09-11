"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { z } from "zod";

import { ZustandStore } from "@acme/shared/common/classes";
import { ProviderId } from "@acme/shared/common/enums";
import { cn } from "@acme/ui";
import { Form, useForm } from "@acme/ui/form";
import { ControlledInput, Input } from "@acme/ui/input";
import { Loader } from "@acme/ui/loader";
import { toast } from "@acme/ui/toast";

export type AuthStatus =
  | "idle"
  | "loading"
  | "verify-email"
  | "verify-code"
  | "error";

export const authStore = new ZustandStore({
  initialState: {
    email: "",
    status: "idle" as AuthStatus,
    text: "",
    callbackUrl: "/",
  },
  persistOptions: {
    name: "auth-store",
    version: 1,
    persistedKeys: ["email"],
    getStorage: () => localStorage,
  },
});

export const SignInFormSchema = z.object({
  email: z.string().email(),
});

export interface SignInComponentProps {
  callbackUrl?: string;
}

export const AuthWrapper = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-1 flex-col items-center bg-background p-8 pb-16 text-center",
        "xs:w-min xs:min-w-[400px] xs:shadow-md xs:rounded-xl xs:pb-8 xs:flex-grow-0 xs:h-auto",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const Loading = ({ text }: { text: string }) => {
  return (
    <div className="flex h-32 w-full flex-col items-center justify-center gap-4">
      <p className="text-center text-lg text-muted-foreground">{text}</p>
      <Loader />
    </div>
  );
};

export const AuthForm = () => {
  const email = authStore.use.email();

  const form = useForm({
    schema: SignInFormSchema,
    mode: "onChange",
    defaultValues: { email },
  });
  const { control, formState, getFieldState, setError, getValues } = form;

  useEffect(() => {
    form.setValue("email", email);
    void form.trigger();
  }, [email, form]);

  const onSubmitEmailLinkAuth = useCallback(() => {
    if (formState.errors.email) {
      toast.error("Please check the form");
      setError("email", {
        message: `Please use a valid email`,
      });
      return;
    }
    authStore.setState({
      status: "loading",
      text: "Sending email link...",
    });
    toast.success("Sending email link...");
    const data = getValues();
    void signIn(ProviderId.EMAIL, {
      callbackUrl: authStore.get("callbackUrl") ?? "/",
      email: data.email,
      redirect: false,
    }).finally(() => {
      // Timeout so it doesn't flicker back
      setTimeout(() => {
        authStore.setState({
          status: "verify-email",
          email: data.email,
        });
      }, 1000);
    });
  }, [formState.errors.email, getValues, setError]);

  const onSubmitEmailCodeAuth = useCallback(() => {
    if (formState.errors.email) {
      toast.error("Please check the form");
      setError("email", {
        message: `Please use a valid email`,
      });
      return;
    }
    authStore.setState({ status: "loading", text: "Sending code..." });
    toast.success("Sending code...");
    const data = getValues();
    void signIn(ProviderId.OTP, {
      email: data.email,
      redirect: false,
    })
      .then((d) => {
        // Timeout so it doesn't flicker back
        setTimeout(() => {
          authStore.setState({
            status: "verify-code",
            email: data.email,
          });
        }, 1000);
        console.log("success", { d });
      })
      .catch(() => {
        authStore.setState({ status: "error", text: "Error sending code" });
      });
  }, [formState.errors.email, getValues, setError]);

  return (
    <Form {...form}>
      <div className="w-full">
        <ControlledInput
          control={control}
          name="email"
          label="Email"
          placeholder="him@f3nation.com"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "NumpadEnter") {
              // Don't check for validity here, because we want to allow the user to sign in with an invalid email
              if (getFieldState("email").invalid) {
                return;
              }
              void onSubmitEmailCodeAuth();
            }
          }}
        />
        <button
          type="button"
          disabled={!!formState.errors.email}
          onClick={onSubmitEmailLinkAuth}
          className="mt-4 flex w-full cursor-pointer justify-center rounded-md bg-foreground px-4 py-2 text-background disabled:bg-foreground/50"
        >
          Sign in with email link
        </button>
        <button
          type="button"
          disabled={!!formState.errors.email}
          onClick={onSubmitEmailCodeAuth}
          className="mt-4 flex w-full cursor-pointer justify-center rounded-md bg-foreground px-4 py-2 text-background disabled:bg-foreground/50"
        >
          Sign in with code
        </button>
        <p className="mt-4 text-justify text-[13px] text-muted-foreground">
          <span className="font-bold text-primary">IMPORTANT</span>: We are
          working on combining all of your F3 data into one unified spot. Map
          data, workout data from different Slack workspaces, etc - all
          together. To link your data between these different places, we're
          going to use your email address. So when you log in,{" "}
          <span className="font-bold">
            use the email you'd like to use for all F3 applications
          </span>{" "}
          going forward.
        </p>
      </div>
    </Form>
  );
};

export const VerifyEmail = () => {
  const email = authStore.use.email();

  return (
    <div className="w-full">
      <h2 className="mb-4 mt-2 text-center text-2xl font-semibold">
        {"Verify your email"}
      </h2>
      <div className="text-center">
        A verification link has been sent to{" "}
        <span className="text-blue-500">{email}</span>!
      </div>
      <div className="mt-4 text-center">
        <span>
          Please follow the link in your email to continue where you left off
        </span>
      </div>
      <div className="mt-6 flex justify-center">
        <button
          className="text-blue-500 underline"
          onClick={() => {
            authStore.setState({ status: "idle" });
          }}
        >
          Return to Sign in
        </button>
      </div>
    </div>
  );
};

export const VerifyCode = () => {
  const email = authStore.use.email();
  const callbackUrl = authStore.use.callbackUrl();
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = useCallback(() => {
    setIsLoading(true);
    try {
      window.location.href = `/api/auth/callback/otp?email=${encodeURIComponent(
        email,
      )}&token=${code}&callbackUrl=${encodeURIComponent(callbackUrl ?? "/")}`;
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [email, code, callbackUrl]);

  return (
    <div className="w-full">
      <h2 className="mb-4 mt-2 text-center text-2xl font-semibold">
        {"Enter code"}
      </h2>
      <div className="text-center">
        An access code has been sent to{" "}
        <span className="text-blue-500">{email}</span>. Please enter the code
        below to continue.
      </div>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123456"
        className="mt-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "NumpadEnter") {
            void onSubmit();
          }
        }}
      />
      <button
        type="button"
        onClick={onSubmit}
        className="mt-4 flex w-full cursor-pointer justify-center rounded-md bg-foreground px-4 py-2 text-background disabled:bg-foreground/50"
      >
        {isLoading ? <Loader /> : "Verify code"}
      </button>
    </div>
  );
};

export const ErrorCard = () => {
  return (
    <div className="flex h-32 w-full flex-col items-center justify-center gap-4">
      <p className="text-lg text-muted-foreground">Error</p>
      <button
        className="text-blue-500 underline"
        onClick={() => {
          authStore.setState({ status: "idle" });
        }}
      >
        Return to Sign in
      </button>
    </div>
  );
};

export const AuthContent = ({
  callbackUrl,
  withWrapper = true,
}: SignInComponentProps & { withWrapper?: boolean }) => {
  const status = authStore.use.status();
  const text = authStore.use.text();

  useEffect(() => {
    authStore.setState({ callbackUrl: callbackUrl ?? "/" });
  }, [callbackUrl]);

  const content = (
    <>
      {status === "loading" ? (
        <Loading text={text ?? "Loading..."} />
      ) : status === "idle" ? (
        <AuthForm />
      ) : status === "verify-email" ? (
        <VerifyEmail />
      ) : status === "verify-code" ? (
        <VerifyCode />
      ) : status === "error" ? (
        <ErrorCard />
      ) : null}
    </>
  );

  return withWrapper ? (
    <AuthWrapper className="py-6">{content}</AuthWrapper>
  ) : (
    content
  );
};
