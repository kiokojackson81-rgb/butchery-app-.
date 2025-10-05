// WhatsApp Utility Templates registry
// Names must match approved templates in Meta (Utility category)

export const WA_TEMPLATES = {
  attendantAssignment: 'barakaops_attendant_assignment_v1',
  supervisorAssignment: 'barakaops_supervisor_assignment_v1',
  supplierAssignment: 'barakaops_supplier_assignment_v1',
  attendantClosingReminder: 'barakaops_attendant_closing_reminder_v1',
  supervisorReviewReminder: 'barakaops_supervisor_review_reminder_v1',
  supplierOpeningReminder: 'barakaops_supplier_opening_reminder_v1',
  roleRemoved: 'barakaops_role_removed_v1',
} as const;

export type WATemplateKey = keyof typeof WA_TEMPLATES;

// Reference bodies (for documentation/dev). Sending uses only names + params.
export const WA_TEMPLATE_BODIES = {
  barakaops_attendant_assignment_v1: `System update: You have been assigned the role of Attendant at {{outlet}}.
You are responsible for managing: {{products}}.
Use this secure link to access your account: {{link}}.
This is an automated update from BarakaOps.`,
  barakaops_supervisor_assignment_v1: `System update: You have been assigned the role of Supervisor for {{outlet}}.
You will review and approve submissions for this outlet.
Access your console here: {{link}}.
This is an automated update from BarakaOps.`,
  barakaops_supplier_assignment_v1: `System update: You have been assigned the role of Supplier for {{outlet}}.
Submit opening deliveries for the current trading day here: {{link}}.
This is an automated update from BarakaOps.`,
  barakaops_attendant_closing_reminder_v1: `Reminder: It’s time to finalize today’s records for {{outlet}}.
Please weigh and record your closing stock. You also have {{pending_deposit}} pending deposit amount(s) to clear.
Submit closing entries and deposits before locking the day.
Log in here: {{link}}.
This is an automated daily reminder from BarakaOps.`,
  barakaops_supervisor_review_reminder_v1: `Reminder: Please review and approve pending submissions for {{outlet}}.
Items awaiting review: closings {{closing_count}}, deposits {{deposit_count}}, expenses {{expense_count}}.
Open your review console: {{link}}.
This is an automated daily reminder from BarakaOps.`,
  barakaops_supplier_opening_reminder_v1: `Reminder: Submit opening deliveries for {{outlet}} for today.
The trading date is {{date}}. Use the link to record quantities and buy prices: {{link}}.
This is an automated daily reminder from BarakaOps.`,
  barakaops_role_removed_v1: `System update: Your {{role}} assignment for {{outlet}} has been removed.
If you believe this is an error, contact Admin.
This is an automated update from BarakaOps.`,
} as const;
