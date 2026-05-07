from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_PATH = OUTPUT_DIR / "security-build-summary-one-pager.pdf"


class Rule(Flowable):
    def __init__(self, color=colors.HexColor("#cbd5e1"), width=1):
        super().__init__()
        self.color = color
        self.width = width

    def wrap(self, avail_width, avail_height):
        self.avail_width = avail_width
        return avail_width, 8

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.width)
        self.canv.line(0, 4, self.avail_width, 4)


def p(text, style):
    return Paragraph(text, style)


def build_pdf():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=letter,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.45 * inch,
        bottomMargin=0.45 * inch,
        title="Security Build Summary",
        author="Tech Team",
    )

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleCustom",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#111827"),
        spaceAfter=4,
    )
    subtitle = ParagraphStyle(
        "Subtitle",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=12,
        textColor=colors.HexColor("#475569"),
        spaceAfter=8,
    )
    section = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=7,
        spaceAfter=4,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#1f2937"),
        spaceAfter=3,
    )
    small = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=7.6,
        leading=9.4,
        textColor=colors.HexColor("#334155"),
    )
    label = ParagraphStyle(
        "Label",
        parent=body,
        fontName="Helvetica-Bold",
        fontSize=8.2,
        leading=10,
        textColor=colors.HexColor("#0f172a"),
    )

    story = [
        p("Security Build Summary", title),
        p("Sales Dashboard CRM - built and hardened by the Tech Team", subtitle),
        Rule(colors.HexColor("#94a3b8")),
        p("What Was Built", section),
        p(
            "The Tech Team completed a security hardening update for the CRM's manager, assistant manager, lead, review, notification, and candidate support workflows.",
            body,
        ),
    ]

    changes = [
        [
            p("Area", label),
            p("Build Completed By Tech Team", label),
            p("Manager Impact", label),
        ],
        [
            p("Session security", small),
            p("Added server-side checks that bind sensitive actions to the real signed-in Appwrite session.", small),
            p("Actions now fail if the browser sends a user ID that does not match the logged-in user.", small),
        ],
        [
            p("User and lead actions", small),
            p("Protected user creation, user updates, lead creation, lead listing, and lead reopen flows.", small),
            p("Managers and assistant managers continue using the same screens, with stronger authorization behind them.", small),
        ],
        [
            p("Email workflows", small),
            p("Required an active CRM session before mock, interview, or assessment emails can be sent through Outlook.", small),
            p("Support email attempts are tied more reliably to the correct user and audit trail.", small),
        ],
        [
            p("Production exposure", small),
            p("Disabled debug configuration output in production.", small),
            p("Internal system identifiers are no longer shown through the production debug route.", small),
        ],
    ]

    table = Table(changes, colWidths=[1.25 * inch, 3.0 * inch, 2.55 * inch], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([table, Spacer(1, 7)])

    story.extend(
        [
            KeepTogether(
                [
                    p("Why This Matters", section),
                    p("- Prevents browser-supplied IDs from being used as proof of identity.", body),
                    p("- Reduces risk of unauthorized user, lead, access-setting, note, queue, and email actions.", body),
                    p("- Improves audit accuracy by tying sensitive activity to the signed-in user session.", body),
                ]
            ),
            KeepTogether(
                [
                    p("What Managers And Assistant Managers Should Do", section),
                    p("1. Use only your own CRM account and log out on shared machines.", body),
                    p("2. If an action says Unauthorized, refresh and sign in again.", body),
                    p("3. Report unexpected access, incorrect audit actors, or missing lead visibility to the Tech Team.", body),
                ]
            ),
            KeepTogether(
                [
                    p("Quality And Verification", section),
                    p("- Focused security regression test passed for matching, mismatched, and missing session user IDs.", body),
                    p("- Production build passed after approved Google Fonts network access.", body),
                    p("- Existing unrelated repo-wide test, TypeScript, and lint issues remain documented in the security scan report.", body),
                ]
            ),
            Spacer(1, 5),
            Rule(colors.HexColor("#cbd5e1")),
            p("Owner: Tech Team | Audience: Managers and Assistant Managers | Status: Implemented", small),
        ]
    )

    doc.build(story)

    reader = PdfReader(str(OUTPUT_PATH))
    if len(reader.pages) != 1:
        raise RuntimeError(f"Expected one page, got {len(reader.pages)}")

    text = reader.pages[0].extract_text() or ""
    required = ["Security Build Summary", "Tech Team", "What Was Built", "Quality And Verification"]
    missing = [item for item in required if item not in text]
    if missing:
        raise RuntimeError(f"Missing expected text: {missing}")

    print(OUTPUT_PATH)


if __name__ == "__main__":
    build_pdf()
