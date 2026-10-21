import { cn } from ".";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

// Next forwards Server Component errors with only an opaque `digest` that
// matches the server-side log line; never render `message`, it can leak
// internals in development builds.
function getErrorDigest(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("digest" in error)) return undefined;
  return typeof error.digest === "string" ? error.digest : undefined;
}

function StatusCard({
  title,
  description,
  className,
  role,
  children,
  footer,
}: {
  title: string;
  description: string;
  className?: string;
  role?: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex min-h-[60dvh] w-full items-center justify-center p-4",
        className,
      )}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription className="text-muted-foreground dark:text-muted-foreground">
            {description}
          </CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
        <CardFooter className="gap-2">{footer}</CardFooter>
      </Card>
    </div>
  );
}

function ErrorScreen({
  error,
  onRetry,
  homeHref = "/",
  className,
}: {
  error: unknown;
  onRetry: () => void;
  homeHref?: string;
  className?: string;
}) {
  const digest = getErrorDigest(error);
  return (
    <StatusCard
      role="alert"
      title="Something went wrong"
      description="An unexpected error occurred. Try again, or head back to the home page."
      className={className}
      footer={
        <>
          <Button onClick={onRetry}>Try again</Button>
          <Button asChild variant="outline">
            <a href={homeHref}>Go home</a>
          </Button>
        </>
      }
    >
      {digest ? (
        <p className="text-xs text-muted-foreground">
          Reference: <code className="font-mono">{digest}</code>
        </p>
      ) : null}
    </StatusCard>
  );
}

function NotFoundScreen({
  homeHref = "/",
  className,
}: {
  homeHref?: string;
  className?: string;
}) {
  return (
    <StatusCard
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      className={className}
      footer={
        <Button asChild>
          <a href={homeHref}>Go home</a>
        </Button>
      }
    />
  );
}

export { ErrorScreen, NotFoundScreen };
