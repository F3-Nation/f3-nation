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
        strokeWidth={0.7}
        d="M.65 13.333c0 6.994 5.69 12.683 12.683 12.683 6.994 0 12.683-5.69 12.683-12.683C26.016 6.339 20.327.65 13.333.65S.65 6.34.65 13.333Zm1.37 0c0-6.238 5.075-11.314 11.313-11.314s11.314 5.076 11.314 11.314c0 6.237-5.076 11.313-11.314 11.313S2.02 19.57 2.02 13.333Z"
      />
      <path
        fill={fillcolor}
        stroke={fillcolor}
        strokeWidth={0.7}
        d="M9.01 16.494h.001l2.983-2.834a.685.685 0 0 1 .968.025L9.01 16.494Zm0 0a.685.685 0 0 0-.024.968l.025-.968Zm3.928-1.841-2.983 2.833 2.983-2.833Zm0 0a.685.685 0 0 0 .024-.968l-.024.968ZM12.649 12.149a.685.685 0 1 0 1.37 0V4.448a.685.685 0 1 0-1.37 0v7.7Z"
      />
      <path
        fill={fillcolor}
        stroke={fillcolor}
        strokeWidth={0.7}
        d="M11.644 13.333a1.69 1.69 0 0 0 3.379 0 1.69 1.69 0 0 0-1.69-1.69 1.69 1.69 0 0 0-1.689 1.69Zm1.37 0a.32.32 0 1 1 .32.32.32.32 0 0 1-.32-.32Z"
      />
    </svg>
  );
}
