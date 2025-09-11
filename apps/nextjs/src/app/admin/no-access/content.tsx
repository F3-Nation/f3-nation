"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import { routes } from "@acme/shared/app/constants";

export default function NoAccess() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const router = useRouter();
  const reason = searchParams?.get("reason");
  console.log("params", searchParams);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="rounded-full bg-red-100 p-3">
            <svg
              className="h-6 w-6 text-red-600"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">
            Access Denied
          </h2>
          <p className="text-gray-600">
            {"You don't have access to the requested resource."}
          </p>
          {reason === "account-does-not-exist" ? (
            <p className="text-sm text-gray-500">
              This account does not exist. You need to create an account first.
            </p>
          ) : !session ? (
            <p className="text-sm text-gray-500">You are not logged in.</p>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                Your roles:{" "}
                {session?.roles?.map((role) => (
                  <span key={role.orgId} className="font-medium text-red-600">
                    {role.orgName} - {role.roleName}
                  </span>
                ))}
                <br />
                Required role:{" "}
                <span className="font-medium text-green-600">
                  data-entry
                </span>{" "}
                or <span className="font-medium text-green-600">admin</span>
              </p>
            </>
          )}
          <button
            onClick={() => router.push(routes.auth.signIn.__path)}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
