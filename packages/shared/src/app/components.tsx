import type { ReactElement } from "react";

// https://blog.hackages.io/conditionally-wrap-an-element-in-react-a8b9a47fab2
export interface ConditionalWrapperProps {
  condition: boolean;
  wrapper: (children: ReactElement) => ReactElement;
  children: ReactElement;
}
export const ConditionalWrapper = ({
  condition,
  wrapper,
  children,
}: ConditionalWrapperProps): ReactElement =>
  condition ? wrapper(children) : children;
