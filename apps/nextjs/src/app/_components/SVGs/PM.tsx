import type { SVGProps } from "react";

interface SVGComponentProps extends SVGProps<SVGSVGElement> {
  fillcolor?: string;
}

export default function TodaySvgComponent(props: SVGComponentProps) {
  const { fillcolor = "#8D8D8D", ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={27}
      height={27}
      viewBox="0 0 20 24"
      fill="none"
      {...rest}
    >
      <path
        fill="none"
        stroke={fillcolor}
        strokeWidth={2}
        d="m18.924 16.462.927-2.242-2.238.938c-1.072.45-2.175.726-3.242.726-4.263 0-7.664-3.336-7.664-7.402 0-1.509.367-2.827 1.13-3.903l1.766-2.486-2.895.958C3.2 4.21 1 7.894 1 11.598 1 16.828 5.356 21 10.664 21c1.679 0 3.419-.41 4.891-1.162 1.464-.747 2.75-1.878 3.37-3.376Z"
      />
    </svg>
  );
}
