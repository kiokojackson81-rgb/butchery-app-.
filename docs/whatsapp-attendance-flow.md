# WhatsApp Attendance Flow Requirements

This document captures the expected behaviour for the WhatsApp-based attendance ("attendnand") assistant so that it mirrors the existing web dashboard flow without regressing any current features.

## General guidance
- **Do not rewrite the existing flow logic.** Extend the current implementation only where necessary to provide parity with the web dashboard.
- **Reuse shared utilities** for state management, product lookups, and validation so that supply, deposit, and other flows continue to behave exactly as they do today.
- **Make all new behaviour opt-in** via feature flags or flow-specific guards when possible. This allows the team to roll back or limit scope quickly if bugs appear.

## Closing stock flow parity
The closing stock conversation must guide the attendant through the exact sequence enforced by the dashboard:

1. **Product selection**
   - Present the full list of products assigned to the attendant.
   - When a product is selected, mark it as the "active" product for the session.

2. **Capture weight**
   - Prompt for the product's closing weight immediately after selection.
   - Validate units and numeric ranges using the same rules as the dashboard. Reject invalid inputs with the same error messages.

3. **Capture waste**
   - After a valid weight is supplied, request the waste amount for the active product.
   - Apply the same validation logic as the web experience (e.g., waste cannot exceed the weight entered).

4. **Advance to next product**
   - Once both weight and waste are provided, persist the record and mark the product as **inactive** for the remainder of the session.
   - Automatically prompt for the next available product. Products already completed must not appear again unless the attendant explicitly triggers an edit action.

5. **Completion**
   - When all assigned products are completed, send a summary identical to the dashboard confirmation, then exit the flow.

## Consistency with other flows
- **Supply, deposit, expense, and summary flows** must continue to behave as they currently do. The closing stock enhancements should not alter their prompts, state transitions, or completion rules.
- Reuse any shared helper that these flows rely on (e.g., product de-duplication, confirmation messaging) rather than duplicating logic.

## Conversation scenarios to prevent silent states
Copilot must stay responsive across the full range of closing-stock interactions. Use these scenarios to guide development and QA so the bot never stalls:

1. **Happy-path completion**
   - Attendant selects the first product, provides valid weight and waste, and is automatically advanced until all products are complete.
   - Bot sends the completion summary and returns to the main menu without waiting for another prompt.

2. **Validation retry loop**
   - Attendant selects a product but supplies an invalid weight (non-numeric or out-of-range).
   - Bot immediately returns the same validation error text as the dashboard and reprompts for weight. After a valid weight, it moves on to waste without needing a manual restart.

3. **Waste correction**
   - Attendant enters a waste amount exceeding the recorded weight.
   - Bot explains the violation, re-asks for waste, and resumes the flow with the corrected value so that no subsequent prompts are skipped.

4. **Product revisit request**
   - After completing a product, the attendant asks to edit it.
   - Bot confirms whether edits are permitted; if yes, it temporarily reactivates the product, gathers corrected values, then returns to the queued product list without losing state. If edits are not allowed, it communicates the reason and resumes with the pending product.

5. **Mid-session status check**
   - Attendant asks, "Which products are left?" or "Show summary so far."
   - Bot responds with the requested status and automatically returns to the pending prompt (e.g., asking for weight of the current product) to avoid dropping the conversation.

6. **Idle timeout safeguard**
   - If no reply is received within the configured idle threshold, bot sends a gentle reminder and preserves the active product context so the next user message can continue where it left off.

7. **Flow exit and resume**
   - When the attendant chooses to exit early (e.g., "go back"), bot confirms the pause and stores progress. On resume, it reopens at the last incomplete product without requiring completed entries to be repeated.

Document each scenario in automated tests or manual QA notes and verify Copilot responds with a message for every user utterance.

## QA checklist for contributors
- [ ] Complete a full closing stock session via WhatsApp and verify each product is removed from the selection list after completion.
- [ ] Attempt to re-select a completed product and confirm the bot prevents duplicate entries.
- [ ] Confirm supply, deposit, and other menu options work unchanged.
- [ ] Compare the final WhatsApp summary to the web dashboard output for the same dataset.

## Daily engagement messaging automation

Implement a scheduled engagement workflow so WhatsApp users receive timely reminders based on their role and recent activity.

- **Schedule:** Trigger the workflow daily at **9:30 PM Africa/Nairobi (GMT+3)**.
- **Trigger logic:**
  1. Look up the user's role and last-activity timestamp (message or dashboard update).
  2. If inactivity exceeds 24 hours, send the inactivity reminder (free-text message) and skip the role-specific daily message.
  3. Otherwise, send the role-specific message using the WhatsApp engagement API.
- **Dynamic placeholders:**
  - Always substitute `{{role_name}}` with the detected role label.
  - If `{{user_first_name}}` exists, prepend the greeting with the name (e.g., "Hello Jane, ...").
- **Delivery channel:** Use the WhatsApp Bot (BarakaOps System) APIs. Prefer session messages; fall back to approved free-text when outside the template window.
- **Links:** Include both login options in every message:
  - WhatsApp bot login: `https://barakafresh.co.ke/login?src=wa`
  - Web dashboard: `https://barakafresh.com/`
- **Role-based daily messages:**
  - **Attendant:**
    > 🌙 Hello Attendant,
    >
    > This is your daily reminder from **Baraka Fresh Butchery Ops** 💼
    >
    > Please remember to **log in to your dashboard** and update all entries for today —
    > ✅ Sales recorded
    > ✅ Stock closing count
    > ✅ Deposits submitted
    > ✅ Wastage or returns captured
    >
    > 🔑 Login using your unique code to continue your work as Attendant.
    >
    > 💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa
    > 🌐 Access via Web Dashboard: https://barakafresh.com/
    >
    > Thank you for keeping your records accurate every day! 💪
    > — Baraka Fresh Team
  - **Supervisor:**
    > 🌙 Hello Supervisor,
    >
    > Friendly reminder from **Baraka Fresh Butchery Ops** 💼
    >
    > Please log in to your dashboard to:
    > ✅ Review attendants’ submissions
    > ✅ Approve daily reports and closing stocks
    > ✅ Verify deposits and expenses
    >
    > 🔑 Login using your unique code to manage your supervisor duties.
    >
    > 💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa
    > 🌐 Access via Web Dashboard: https://barakafresh.com/
    >
    > Thank you for ensuring accuracy and accountability daily! 🙌
    > — Baraka Fresh Team
  - **Admin:**
    > 🌙 Hello Admin,
    >
    > This is your 9:30 PM system reminder from **Baraka Fresh Butchery Ops** 💼
    >
    > Please log in to your dashboard to:
    > ✅ Review outlet summaries
    > ✅ Confirm reports from supervisors
    > ✅ Monitor deposits and balances
    > ✅ Update records or resolve pending issues
    >
    > 🔑 Login using your admin code to manage system operations.
    >
    > 💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa
    > 🌐 Access via Web Dashboard: https://barakafresh.com/
    >
    > Thank you for keeping Baraka Fresh running smoothly! ⚙️
    > — Baraka Fresh Team
  - **Supplier:**
    > 🌙 Hello Supplier,
    >
    > A quick reminder from **Baraka Fresh Butchery Ops** 💼
    >
    > Please log in to your supplier dashboard to:
    > ✅ Review today’s deliveries
    > ✅ Confirm supplies received by outlets
    > ✅ Plan tomorrow’s dispatch if needed
    >
    > 🔑 Login using your supplier code to stay updated.
    >
    > 💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa
    > 🌐 Access via Web Dashboard: https://barakafresh.com/
    >
    > Thank you for keeping our supply chain reliable and consistent! 🚛
    > — Baraka Fresh Team
- **Inactivity fallback message:**
    > 🌙 Hello {{role_name}},
    >
    > We noticed you haven’t been active today on **Baraka Fresh Butchery Ops** 💼
    >
    > Kindly remember to **log in to your dashboard** to review or update your daily records.
    > This helps keep operations accurate and up to date for everyone.
    >
    > 🔑 Please log in using your unique code to continue your role as {{role_name}}.
    >
    > 💬 Access via WhatsApp: https://barakafresh.co.ke/login?src=wa
    > 🌐 Access via Web Dashboard: https://barakafresh.com/
    >
    > Thank you for staying consistent with your updates and teamwork! 💪
    > — Baraka Fresh Team
- **Safety checks:** Log each outbound message with timestamp, role, and trigger reason. Include metrics or alerts for failed sends so operations can intervene quickly.
- **QA:** Simulate both active and inactive users for each role to confirm correct message selection, placeholder substitution, and link rendering.

These automation rules complement the conversation flow guidelines, ensuring both interactive sessions and proactive reminders mirror the existing Baraka Fresh operations standards.

Following these steps will ensure the WhatsApp bot behaves identically to the web dashboard without introducing regressions. 
