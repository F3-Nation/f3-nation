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
      viewBox="0 0 27 27"
      fill="none"
      {...rest}
    >
      <path
        fill={fillcolor}
        stroke={fillcolor}
        d="M1.34 26.196h24.32a.84.84 0 0 0 .84-.84V3.938a.84.84 0 0 0-.84-.84H1.34a.84.84 0 0 0-.84.84v21.417c0 .464.376.841.84.841ZM24.82 4.78v19.736H2.182V4.779h22.637Z"
      />
      <path
        fill={fillcolor}
        stroke={fillcolor}
        d="M18.818 5.77a.84.84 0 1 0 1.682 0V1.34a.84.84 0 1 0-1.682 0v4.43ZM6.328 5.77a.84.84 0 1 0 1.681 0V1.34a.84.84 0 1 0-1.681 0v4.43Z"
      />
      <path
        fill={fillcolor}
        stroke={fillcolor}
        d="M1.588 8.143h24.071a.84.84 0 1 0 0-1.682H1.588a.84.84 0 1 0 0 1.682Z"
      />
    </svg>
  );
}
