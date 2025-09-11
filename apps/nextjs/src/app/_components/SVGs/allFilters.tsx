import type { SVGProps } from "react";

interface SVGComponentProps extends SVGProps<SVGSVGElement> {
  fillcolor?: string;
}

export default function AllFiltersSvgComponent(props: SVGComponentProps) {
  const { fillcolor = "#8D8D8D", ...rest } = props;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={27}
      height={27}
      viewBox="0 0 25 22"
      fill="none"
      {...rest}
    >
      <path
        stroke={fillcolor}
        strokeWidth={2}
        d="M23.096 1H3l7.334 9.611v10.485l5.281-2.621V10.61L23.096 1Z"
      />
    </svg>
  );
}
