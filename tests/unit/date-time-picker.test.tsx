import { render, screen } from "@testing-library/react";
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
});
