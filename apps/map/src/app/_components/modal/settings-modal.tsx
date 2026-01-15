import {
  ArrowRight,
  Eye,
  Info,
  LockKeyholeOpen,
  LogIn,
  LogOut,
  MessageCircleQuestion,
  Moon,
  Pencil,
  QrCode,
  RefreshCcw,
  Shield,
  Sun,
} from "lucide-react";
import { signIn } from "next-auth/react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useCallback } from "react";

import { Z_INDEX } from "@acme/shared/app/constants";
import { isDevelopment, isProd } from "@acme/shared/common/constants";
import { ProviderId } from "@acme/shared/common/enums";
import { cn } from "@acme/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@acme/ui/dialog";
import { toast } from "@acme/ui/toast";

import { orpc } from "~/orpc/react";
import { useAuth } from "~/utils/hooks/use-auth";
import { appStore } from "~/utils/store/app";
import { mapStore } from "~/utils/store/map";
import { closeModal, ModalType, openModal } from "~/utils/store/modal";
import { VersionInfo } from "../version-info";

export default function SettingsModal() {
  const showDebug = mapStore.use.showDebug();
  const mode = appStore.use.mode();
  const tiles = mapStore.use.tiles();
  const { theme, setTheme } = useTheme();
  const { session, isNationAdmin, isEditorOrAdmin } = useAuth();
  const center = mapStore.use.center();
  const zoom = mapStore.use.zoom();

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/?lat=${center.lat}&lng=${center.lng}&zoom=${zoom}`;

    await navigator.clipboard.writeText(url);

    toast.success("Link copied to clipboard");
  };

  const handleQRModal = useCallback(() => {
    openModal(ModalType.QR_CODE, {
      title: "Link to current map location",
      url: `${window.location.origin}/?lat=${center.lat}&lng=${center.lng}&zoom=${zoom}`,
      fileName: "Link to current map location",
    });
  }, [center, zoom]);

  return (
    <Dialog open={true} onOpenChange={closeModal}>
      <DialogContent
        style={{ zIndex: Z_INDEX.HOW_TO_JOIN_MODAL }}
        className={cn(`max-w-[90%] rounded-lg lg:max-w-[400px]`)}
      >
        <DialogHeader>
          <DialogTitle className="text-center">Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col justify-start space-y-4 px-4 text-left">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-muted-foreground">
              Current location
            </p>
            <div className="flex flex-row items-center gap-2">
              <button
                className="flex flex-col items-center gap-1 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
                onClick={handleQRModal}
              >
                <QrCode />
              </button>
              <div className="flex flex-col items-start rounded-md text-sm text-gray-500">
                {center.lat.toFixed(3)}, {center.lng.toFixed(3)} (
                {zoom.toFixed(1)})
                <button
                  className="text-sm font-medium text-gray-500 underline"
                  onClick={handleCopyLink}
                >
                  Copy link
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-muted-foreground">Map tiles</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => mapStore.setState({ tiles: "street" })}
                className={cn(
                  "relative flex flex-col items-center gap-1 overflow-hidden rounded-md border-2 border-transparent bg-card p-2 shadow-sm hover:bg-accent",
                  {
                    "bg-primary text-white hover:bg-primary/90":
                      tiles === "street",
                  },
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={"/street.jpg"}
                  alt={tiles}
                  className="absolute inset-0 -top-[50%] object-cover"
                />
                <Eye className="size-5" />
                <span className="text-xs">Street</span>
              </button>
              <button
                onClick={() => mapStore.setState({ tiles: "hybrid" })}
                className={cn(
                  "relative flex flex-col items-center gap-1 overflow-hidden rounded-md border-2 border-transparent bg-card p-2 shadow-sm hover:bg-accent",
                  {
                    "bg-primary text-white hover:bg-primary/90":
                      tiles === "hybrid",
                  },
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={"/satellite.jpg"}
                  alt={tiles}
                  className="absolute inset-0 -top-[50%] object-cover"
                />
                <Pencil className="size-5" />
                <span className="text-xs">Satellite</span>
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-muted-foreground">Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => appStore.setState({ mode: "view" })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md bg-card p-2 shadow-sm hover:bg-accent",
                  {
                    "bg-primary text-white hover:bg-primary/90":
                      mode === "view",
                  },
                )}
              >
                <Eye className="size-5" />
                <span className="text-xs">View</span>
              </button>
              <button
                disabled={!session}
                onClick={() => {
                  appStore.setState({ mode: "edit" });
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md bg-card p-2 shadow-sm hover:bg-accent",
                  "disabled:pointer-events-none disabled:opacity-20",
                  {
                    "bg-blue-500 text-white hover:bg-blue-500/90":
                      mode === "edit",
                  },
                )}
              >
                <Pencil className="size-5" />
                <span className="text-xs">Edit</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "view"
                ? "(Default) View mode - View and filter workouts"
                : "Edit mode - Submit requests to add or edit workouts"}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-muted-foreground">Theme</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTheme("light")}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md bg-card p-2 shadow-sm hover:bg-accent",
                  {
                    "bg-primary text-white hover:bg-primary/90":
                      theme === "light",
                  },
                )}
              >
                <Sun className="size-5" />
                <span className="text-xs">Light</span>
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md bg-card p-2 shadow-sm hover:bg-accent",
                  {
                    "bg-primary text-white hover:bg-primary/90":
                      theme === "dark",
                  },
                )}
              >
                <Moon className="size-5" />
                <span className="text-xs">Dark</span>
              </button>
              {/* 
              // Turn off system for now
              <button
                onClick={() => setTheme("system")}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md bg-card p-2 shadow-sm hover:bg-accent",
                  {
                    "bg-primary text-white hover:bg-primary/90":
                      theme === "system",
                  },
                )}
              >
                <SunMoon className="size-5" />
                <span className="text-xs">System</span>
              </button> */}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-muted-foreground">Access</p>
            {!session ? (
              <>
                <button
                  className={cn(
                    "flex w-full flex-row items-center justify-center gap-1 rounded-md bg-primary p-2 text-primary-foreground shadow-sm hover:bg-primary/90",
                  )}
                  onClick={() => {
                    closeModal();
                    openModal(ModalType.SIGN_IN, { callbackUrl: "/" });
                  }}
                >
                  <LogIn className="size-4" />
                  <span className="text-xs">Sign in</span>
                </button>
                {!isProd && (isDevelopment || showDebug) ? (
                  <button
                    className={cn(
                      "flex w-full flex-row items-center justify-center gap-1 rounded-md bg-primary p-2 text-primary-foreground shadow-sm hover:bg-primary/90",
                    )}
                    onClick={() => {
                      signIn(ProviderId.DEV_MODE, {
                        email: "admin@mountaindev.com",
                        redirect: true,
                      }).catch((error: unknown) => {
                        console.log("DevModeSignIn", { error });
                        toast.error("Failed to sign in. Use regular sign in.");
                      });
                    }}
                  >
                    <LogIn className="size-4" />
                    <span className="text-xs">Sign in (Dev Mode)</span>
                  </button>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-bold text-muted-foreground">
                    Signed in as
                    <span className="ml-1 font-semibold text-primary">
                      {session.email}
                    </span>
                  </p>
                  {// Keep the nullish check on roles for legacy sessions that did not have roles
                  session.roles?.map((role) => (
                    <p
                      key={`${role.orgId}-${role.roleName}`}
                      className="text-xs text-gray-500"
                    >
                      {role.orgName} ({role.roleName})
                    </p>
                  ))}
                </div>
                {isEditorOrAdmin && (
                  <Link href={"/admin"}>
                    <button
                      className={cn(
                        "flex w-full flex-row items-center justify-center gap-1 rounded-md bg-background p-2 text-foreground shadow-sm hover:bg-accent",
                      )}
                      onClick={() => {
                        closeModal();
                      }}
                    >
                      <Shield className="size-4" />
                      <span className="text-xs">Admin Portal</span>
                    </button>
                  </Link>
                )}
                <Link
                  href={"/api/auth/signout"}
                  onClick={() => {
                    closeModal();
                  }}
                >
                  <button
                    className={cn(
                      "flex w-full flex-row items-center justify-center gap-1 rounded-md bg-card p-2 text-foreground shadow-sm hover:bg-accent",
                    )}
                  >
                    <LogOut className="size-4" />
                    <span className="text-xs">Sign out</span>
                  </button>
                </Link>
              </div>
            )}
            {isNationAdmin ? (
              <button
                className={cn(
                  "flex w-full flex-row items-center justify-center gap-1 rounded-md bg-card p-2 text-foreground shadow-sm hover:bg-accent",
                )}
                onClick={() => {
                  void orpc.org.revalidate
                    .call()
                    .then(() => {
                      toast.success("Nation revalidated");
                    })
                    .catch((error: unknown) => {
                      console.log("RevalidateNation", { error });
                      toast.error("Failed to revalidate Nation");
                    });
                }}
              >
                <RefreshCcw className="size-4" />
                <span className="text-xs">Revalidate map</span>
              </button>
            ) : null}

            <Link
              className="flex w-full flex-row items-center justify-center gap-2 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
              target="_blank"
              href={"https://forms.gle/8AR4JCK3txSVr1Xy7"}
            >
              <LockKeyholeOpen className="size-4" />
              <span className="text-xs">Request admin access</span>
              <ArrowRight className="size-3 text-foreground" />
            </Link>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-muted-foreground">Info</p>
            <button
              className="flex w-full flex-row items-center justify-center gap-2 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
              onClick={() => {
                openModal(ModalType.ABOUT_MAP);
              }}
            >
              <Info className="size-4" />
              <span className="text-xs">About</span>
            </button>
            <button
              className="flex w-full flex-row items-center justify-center gap-2 rounded-md bg-card p-2 shadow-sm hover:bg-accent"
              onClick={() => {
                openModal(ModalType.MAP_HELP);
              }}
            >
              <MessageCircleQuestion className="size-4" />
              <span className="text-xs">Help</span>
            </button>
          </div>
          <VersionInfo className="text-center text-xs text-foreground/60" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
