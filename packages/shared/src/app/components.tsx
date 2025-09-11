import type { ReactElement } from "react";

// https://blog.hackages.io/conditionally-wrap-an-element-in-react-a8b9a47fab2
export interface ConditionalWrapperProps {
  condition: boolean;
  wrapper: (children: ReactElement) => JSX.Element;
  children: JSX.Element;
}
export const ConditionalWrapper = ({
  condition,
  wrapper,
  children,
}: ConditionalWrapperProps): JSX.Element =>
  condition ? wrapper(children) : children;
