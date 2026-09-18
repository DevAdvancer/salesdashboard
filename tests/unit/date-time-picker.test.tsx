import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";

import { DateTimePicker } from "@/components/ui/date-picker";

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

    await user.type(screen.getByLabelText("Date"), "2026-05-15");
    await user.selectOptions(screen.getByLabelText("Hour"), "03");
    await user.selectOptions(screen.getByLabelText("Minute"), "30");
    await user.selectOptions(screen.getByLabelText("AM/PM"), "PM");

    expect(screen.queryByRole("dialog", { name: /date and time picker/i })).not.toBeInTheDocument();
    expect(handleChange).toHaveBeenLastCalledWith("2026-05-15T15:30");
  });

  it("does not retain a past time when a minimum is supplied", () => {
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

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-12" } });
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T12:01");

    expect(screen.getByRole("option", { name: "AM" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("AM/PM"), { target: { value: "AM" } });
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T12:01");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-11" } });
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
    expect(within(screen.getByLabelText("Hour")).getByRole("option", { name: "00" })).toBeDisabled();
    expect(screen.queryByLabelText("AM/PM")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Hour"), "22");
    await user.selectOptions(screen.getByLabelText("Minute"), "30");
    expect(handleChange).toHaveBeenLastCalledWith("2026-09-12T22:30");
  });
});
