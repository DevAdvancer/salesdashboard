jest.mock("wxt/browser", () => ({ browser: {} }), { virtual: true });
import { readPageTheme } from "@/extensions/linkedin-helper/lib/use-page-theme";

afterEach(() => jest.restoreAllMocks());

it.each([["rgb(244, 242, 238)", "light"], ["rgb(255, 255, 255)", "light"], ["rgb(29, 34, 38)", "dark"]])(
  "follows the page background %s instead of system preference", (color, expected) => {
    jest.spyOn(window, "getComputedStyle").mockReturnValue({ backgroundColor: color } as CSSStyleDeclaration);
    expect(readPageTheme()).toBe(expected);
  },
);

it("uses the document background when the body is transparent", () => {
  jest.spyOn(window, "getComputedStyle").mockImplementation(element => ({ backgroundColor:
    element === document.body ? "rgba(0, 0, 0, 0)" : "rgb(255, 255, 255)" } as CSSStyleDeclaration));
  expect(readPageTheme()).toBe("light");
});
