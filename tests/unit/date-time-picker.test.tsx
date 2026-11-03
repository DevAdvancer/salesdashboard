import { selectCrmDate, selectCrmOption } from '@/tests/helpers/custom-controls';
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";

import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";

describe("DatePicker", () => {
  it("displays the selected calendar day without shifting it to the previous Eastern day", () => {
    render(<DatePicker value="2026-10-14" onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /Oct 14, 2026/ })).toBeInTheDocument();
  });
});

describe("DateTimePicker", () => {
  it("lets users pick a date, time, and AM/PM without a clipped popup", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    const ControlledPicker = () => {
      const [value, setValue] = useState("");

      return (
        <DateTimePicker
          value={value}
          onChange={(nextValue) => {
            handleChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    };

    render(
      <div data-testid="scroll-container" style={{ overflow: "auto", height: 48 }}>
        <ControlledPicker />
      </div>,
    );

    await selectCrmDate(screen.getByLabelText("Date"), "2026-05-15");
    await selectCrmOption(screen.getByLabelText("Hour"), "03");
    await selectCrmOption(screen.getByLabelText("Minute"), "30");
    await selectCrmOption(screen.getByLabelText("AM/PM"), "PM");

    expect(screen.queryByRole("dialog", { name: /date and time picker/i })).not.toBeInTheDocument();
    expect(handleChange).toHaveBeenLastCalledWith("2026-05-15T15:30");
  });

  it("does not retain a past time when a minimum is supplied", async () => {
    const handleChange = jest.fn();
    const ControlledPicker = () => {
      const [value, setValue] = useState("");
      return (
        <DateTimePicker
          value={value}
          min="2026-09-12T12:01"
          onChange={(nextValue) => {
            handleChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    };

    render(<ControlledPicker />);

    await selectCrmDate(screen.getByLabelText("Date"), "2026-09-12");
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T12:01");

    await userEvent.click(screen.getByLabelText("AM/PM"));
    expect(screen.getByRole("option", { name: "AM", exact: true })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T12:01");

    await userEvent.click(screen.getByLabelText("Date"));
    expect(screen.getByRole("button", { name: "Sep 11, 2026" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T12:01");
  });

  it("uses 00–23 hours without AM/PM when the 24-hour format is selected", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    const ControlledPicker = () => {
      const [value, setValue] = useState("2026-09-12T13:05");
      return (
        <DateTimePicker
          value={value}
          min="2026-09-12T12:01"
          hourFormat="24"
          onChange={(nextValue) => {
            handleChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    };

    render(<ControlledPicker />);

    expect(screen.getByLabelText("Hour")).toHaveValue("13");
    await user.click(screen.getByLabelText("Hour"));
    expect(screen.getByRole("option", { name: "00", exact: true })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("AM/PM")).not.toBeInTheDocument();

    await selectCrmOption(screen.getByLabelText("Hour"), "22");
    await selectCrmOption(screen.getByLabelText("Minute"), "30");
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T22:30");
  });
});
