import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockDialog } from "@/components/mock/mock-dialog";
import { AssessmentDialog } from "@/components/assessment-support/assessment-dialog";
import { InterviewDialog } from "@/components/interview-support/interview-dialog";
import { INITIAL_FORM_DATA as mockData } from "@/components/mock/mock-types";
import { INITIAL_FORM_DATA as assessmentData } from "@/components/assessment-support/assessment-types";
import { INITIAL_FORM_DATA as interviewData } from "@/components/interview-support/interview-types";

const dialogs = [
  { name: "Mock Interview", Component: MockDialog, initial: mockData, field: "role" },
  { name: "Assessment Support", Component: AssessmentDialog, initial: assessmentData, field: "technology" },
  { name: "Interview Support", Component: InterviewDialog, initial: interviewData, field: "technology" },
];

describe.each(dialogs)("$name technology selection", ({ Component, initial, field }) => {
  function Harness({ onSend }: { onSend: (value: string) => void }) {
    const [data, setData] = useState({ ...mockData, ...assessmentData, ...interviewData, ...initial });
    return (
      <Component
        isModalOpen
        setIsModalOpen={jest.fn()}
        formData={data}
        setFormData={setData}
        fileInputKey={0}
        resumeInputKey={0}
        additionalInputKey={0}
        handleFileChange={jest.fn()}
        sendEmail={() => onSend(data[field as "role" | "technology"])}
        isSending={false}
        formatDateEST={(value: string) => value}
        formatScheduleEST={(value: string) => value}
      />
    );
  }

  it("offers the requested choices and sends the selected technology", async () => {
    const user = userEvent.setup();
    const onSend = jest.fn();
    render(<Harness onSend={onSend} />);
    const select = screen.getByRole("combobox", { name: "Technology" });
    expect(Array.from(select.querySelectorAll("option")).map((option) => option.textContent))
      .toEqual(["Select technology", "Data Analyst", "Software Developer", "DevOPs", "AIML", "Other"]);
    const send = screen.getByRole("button", { name: /^(Send (Assessment )?Request|Create Mock)$/ });
    expect(send).toBeDisabled();

    for (const technology of ["Data Analyst", "Software Developer", "DevOPs", "AIML"]) {
      await user.selectOptions(select, technology);
      await user.click(send);
      expect(onSend).toHaveBeenLastCalledWith(technology);
    }
    expect(screen.queryByRole("textbox", { name: "Other technologies" })).not.toBeInTheDocument();
  });

  it("accepts three custom entries, blocks a fourth and clears Other when switching", async () => {
    const user = userEvent.setup();
    const onSend = jest.fn();
    render(<Harness onSend={onSend} />);
    const select = screen.getByRole("combobox", { name: "Technology" });
    const send = screen.getByRole("button", { name: /^(Send (Assessment )?Request|Create Mock)$/ });
    await user.selectOptions(select, "Other");
    const input = screen.getByRole("textbox", { name: "Other technologies" });
    expect(send).toBeDisabled();

    fireEvent.change(input, { target: { value: "Java, Python, React" } });
    await user.click(send);
    expect(onSend).toHaveBeenLastCalledWith("Java, Python, React");
    onSend.mockClear();

    fireEvent.change(input, { target: { value: "Java, Python, React, SQL" } });
    expect(screen.getByRole("alert")).toHaveTextContent("up to 3");
    await user.click(send);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Java,,React" } });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: "Java, Python" } });
    expect(send).toBeEnabled();

    await user.selectOptions(select, "AIML");
    expect(screen.queryByRole("textbox", { name: "Other technologies" })).not.toBeInTheDocument();
    await user.click(send);
    expect(onSend).toHaveBeenLastCalledWith("AIML");
    await user.selectOptions(select, "Other");
    expect(screen.getByRole("textbox", { name: "Other technologies" })).toHaveValue("");
    expect(send).toBeDisabled();
  });
});
