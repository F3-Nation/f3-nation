import React, { useEffect } from "react";

export const useOnKeyPress = <T extends HTMLElement>({
  keys,
  cb,
}: {
  keys?: string[];
  cb: (key?: string) => void;
}) => {
  const ref = React.useRef<T | null>(null);

  useEffect(() => {
    const refCurrent = ref.current;

    const handlePress = function (event: HTMLElementEventMap["keypress"]) {
      // If the user presses the "Enter" key on the keyboard
      if (keys?.includes(event.key)) {
        // Cancel the default action, if needed
        event.preventDefault();
        // Trigger the button element with a click
        cb(event.key);
      }
    };
    refCurrent?.addEventListener("keypress", handlePress);

    return () => {
      refCurrent?.removeEventListener("keypress", handlePress);
    };
  }, [cb, keys]);

  return { ref };
};

// https://react-hook-form.com/faqs#question5:~:text=%7D-,How%20to%20share%20ref%20usage%3F,-React%20Hook%20Form
// For reack hook form:
//   const { ref } = useOnKeyPress<HTMLInputElement>({
//     cb: (key) => {
//       console.log('key', key)
//     },
//   })
//   const { ref: rhfRef, ...registerEmail } = register('email')
//   useImperativeHandle(rhfRef, () => ref?.current)
//   return (
//     <input
//       {...registerEmail}
//       ref={ref}
//     />
//   )
// }
