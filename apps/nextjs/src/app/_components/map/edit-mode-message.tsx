import { appStore } from "~/utils/store/app";

export const EditModeMessage = () => {
  const mode = appStore.use.mode();
  if (mode !== "edit") return null;
  return (
    <button
      className="z-10 m-2 w-max rounded-md bg-blue-600/80 p-1 px-2 text-center text-xs text-white"
      onClick={() => {
        appStore.setState({ mode: "view" });
      }}
    >
      Edit mode is on. Press here to turn it off.
    </button>
  );
};
