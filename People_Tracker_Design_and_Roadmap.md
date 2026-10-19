# People Tracker — Design Specification & Roadmap

**Version:** 0.1 (planning specification)  
**Date:** October 18, 2026  
**Created and Developed by Dennis Senior**  
**Tagline:** *More than contacts. It's about connections.*

## 1. Mission

People Tracker was created with a simple belief: **People matter, and relationships deserve attention.**

Life introduces us to family, friends, neighbors, coworkers, and others who become part of our journey. Our mission is to provide a simple, thoughtful way to organize the people in our lives, remember the things that matter to them, and nurture meaningful relationships.

People Tracker goes beyond names, addresses, and phone numbers. It helps us remember conversations, celebrate milestones, stay connected, and make time for the people who enrich our lives.

**Because the most important things we keep track of aren't things at all. They're people.**

## 2. Product Direction

- **Option A selected:** Build a standalone, general-purpose People Tracker, rather than extending the separate Service Circle concept.
- Keep everyday contact management easy to use; relationship-management features remain optional.
- Support many signed-in users with **private, user-owned data**.
- Allow each person to belong to multiple user-defined groups.
- Allow group sharing by **copying basic contact records** into another user's dataset, not through live synchronization.
- Provide Google Contacts-compatible **CSV import and export in v0.1**.
- Make scheduled contact optional, with **N/A as the default**.

## 3. Version 0.1 — Required Features

### 3.1 People

Each person may have:

- First name, last name, preferred name / nickname, and optional middle name
- Profile photo (optional)
- Multiple phone numbers and email addresses, with labels (mobile, home, work, etc.)
- Mailing address(es), with structured street, city, region/state, postal code, and country fields
- Birthday and anniversary (optional)
- Organization, occupation, job title (optional)
- Active / archived / deceased status, where useful
- Membership in zero, one, or multiple groups
- Optional pinned / priority marker
- General notes and dated journal history
- Links to other people through relationships

### 3.2 Groups

- Create, rename, describe, and archive groups; optional color and icon.
- Add or remove people from groups without deleting their underlying contact records.
- Search and filter by group, and allow membership in multiple groups.
- View a group roster and share or export it.

### 3.3 Notes and Journal

- **General notes:** persistent reference details about an individual.
- **Journal entries:** dated interactions with type (call, text, visit, activity, other), narrative, and optional attachments/photos.
- Optional follow-up date on a journal entry.
- Notes and journal history are **private** and excluded from group sharing and default contact CSV exports.

### 3.4 Relationships and Households

- Link person records with relationships such as spouse, partner, parent, child, sibling, or other.
- Support a household grouping and shared address without forcing everyone to use the same contact details.

### 3.5 Contact Reminders

- **Default frequency: N/A** — no reminders or overdue status.
- Other intervals: weekly, every 2 weeks, monthly, every 6 weeks, quarterly, every 6 months, annually, and custom.
- Track last contact, calculated next contact, and an optional manually selected follow-up date.
- Dashboard views for overdue, due soon, and recently contacted people; exclude N/A from due/overdue counts.
- Pinning a person does not automatically assign them a contact interval.

### 3.6 Activities

- Plan an activity or visit with title, date/time, location, participants, notes, and status.
- Associate multiple contacts with a single activity.
- Optionally record the completed activity in participants' journal histories.

### 3.7 Search and Filters

- Search by name, phone, email, address, group, and appropriate contact fields.
- Filters for group, pinned status, birthdays, next-contact status, and recent contact.
- Allow combinations of useful filters.

### 3.8 Group Sharing — Copy, Not Sync

1. Sender chooses a group and clicks **Share Group**.
2. Application shows a preview of the people and basic fields to be shared.
3. Sender identifies another registered People Tracker user; the recipient receives an invitation.
4. Recipient accepts and chooses to create a new group or use an existing group.
5. Application checks for possible matching contacts using email, phone, and name; recipient can **create, merge, or skip** potential duplicates.
6. Imported members are assigned to the destination group, and a summary shows created, matched, and skipped contacts.

**Included in sharing:** names, preferred names, phone numbers, email addresses, postal addresses, group name/description, and optional profile photo (if explicitly selected).

**Never included in group sharing:** notes, journals, contact history, reminder settings, pin status, activities, or private relationships unless a later version explicitly defines a separate consent-based mechanism.

**Ownership rule:** Recipient receives independently owned copies. Subsequent changes by either user do **not** propagate automatically.

**Safety rule:** Duplicate matching must never silently overwrite a recipient's existing data. Repeatedly accepting the same shared group should not produce uncontrolled duplicates.

### 3.9 CSV Export — Mandatory in v0.1

Provide export of **all contacts**, **a selected group**, or **selected people**.

Formats:

- **Google Contacts CSV:** Use Google's currently published CSV template and exact supported column headers and field encodings at implementation time; include multiple labeled phones/emails/addresses, names, relevant birthdays and organizations, and group labels as applicable.
- **Standard CSV:** Human-readable, documented columns appropriate for spreadsheets and general migration.

Requirements:

- One row per contact where the destination format supports it.
- Preserve multiple group memberships in Google Contacts' supported labels representation.
- When exporting a single group, allow either only that group label or all of the contact's labels.
- Use UTF-8 and proper CSV escaping for commas, quotation marks, and newlines.
- Preserve international phone number formatting and avoid spreadsheet auto-formatting problems where practical.
- **Exclude private notes, journals, reminders, pins, and activities** from the default export.
- Preview total contacts and fields before download.
- Validate and, if necessary, split large exports according to Google's limits as verified at implementation time.
- Test the resulting CSV by round-trip import into Google Contacts using a representative sample.

### 3.10 CSV Import — Mandatory in v0.1

- Import **Google Contacts CSV** using documented headers and labels; optionally support standard People Tracker CSV.
- Show a preview and mapping/error report before applying changes.
- Recognize multiple phone/email/address fields and group labels; offer to create missing groups.
- Detect likely duplicates and provide **create / merge / skip** decisions.
- Preserve existing private notes, histories, and preferences when matching a record.
- Show counts of created, updated/matched, skipped, and invalid rows.
- Handle encoding, empty fields, quoted values, and unexpected columns safely.
- Provide a way to cancel before import is committed.

### 3.11 About Screen — Mandatory in v0.1

Accessible via **ⓘ About** in Settings or the main navigation. Include:

- App name and tagline
- Mission statement (Section 1)
- Brief description of key capabilities
- Current application version (generated from release metadata)
- Credit: **Created and Developed by Dennis Senior**
- © 2026 Dennis Senior (update copyright year as appropriate)
- Optional **What's New** / release history area for future versions

### 3.12 Help / Instructions — Mandatory in v0.1

Accessible via a clearly labeled **❓ Help / Instructions** button near the bottom of navigation.

- Simple numbered steps, written for nontechnical users.
- Built-in help; no need to leave the application.
- Searchable topics: Getting Started; Managing People; Groups; Sharing Groups; Import; Export; Notes & Journal; Reminders; Activities.
- Context-sensitive help (e.g., from the Share Group screen) where practical.
- Help text updated with each release so it describes actual behavior.

## 4. Proposed Navigation and Screens

**Main navigation:** Dashboard · People · Groups · Activities · Journal · Reminders · Settings · Help / Instructions · About.

**Core screens:**

1. **Dashboard:** overview of upcoming reminders, pinned people, planned activities, and quick actions.
2. **People List:** searchable/filterable roster, add contact, bulk select, import/export.
3. **Person Profile:** tabs for Contact Info, Groups, Notes, Journal, Relationships, and Activities.
4. **Groups:** list and details; create/edit; members; Share Group; Export Group.
5. **Import Wizard:** choose file → preview/map → review possible duplicates/groups → confirm → results.
6. **Export Wizard:** select scope and format → preview privacy/labels → download.
7. **Share Group Flow:** choose group → preview basic fields → choose recipient → invitation → recipient review and import summary.
8. **Reminders:** due/overdue and schedule settings, including N/A.
9. **Activities:** upcoming/completed activities and participant selection.
10. **Help and About:** simple in-app resources.

Desktop can use left navigation; mobile should offer a compact navigation pattern without removing functions.

## 5. Data Architecture — High-Level Proposal

**Preferred approach:** a shared application database with **per-user ownership**, rather than a separate physical database for each person. All contact-related reads/writes must be scoped and authorized by the signed-in user's ID; UI filtering alone is not sufficient.

| Entity / table | Responsibility |
|---|---|
| Users | Authentication identity and user profile |
| People | Per-user contact records |
| ContactMethods | Multiple per-person phones and emails |
| Addresses | Structured postal addresses |
| Groups | Per-user group definitions |
| GroupMembers | Many-to-many contact/group membership |
| Relationships | Links between people owned by the same user |
| Households / HouseholdMembers | Shared household associations |
| Notes | General private notes |
| JournalEntries | Dated private interaction records |
| Activities / ActivityParticipants | Planned/completed activities and participants |
| ContactSchedules | Frequency, last contact, next contact, overrides |
| GroupShareInvitations | Pending/completed/declined group share requests |
| Attachments | Secure contact photos and attached files |
| ImportExportHistory | Optional diagnostics and import/share deduplication metadata |

**Important implementation rules:**

- Use stable internal IDs and a user/owner ID for every user-owned entity.
- Enforce ownership in database queries, application authorization, and attachment access.
- Group sharing uses a controlled export/import workflow; internal IDs are remapped for the recipient.
- Apply server-side validation, import size limits, and safe file processing.
- Avoid unnecessary retention of raw uploaded CSV data; protect personal information at rest and in transit.
- Provide backup/restore and account-data export planning before production launch.

## 6. Roadmap

### Phase 0 — Foundation and UX Plan

**Goal:** Turn this specification into a build-ready plan.

- [ ] Confirm application name and visual direction.
- [ ] Select technology stack and hosting approach.
- [ ] Define authentication, user ownership, and authorization strategy.
- [ ] Design the data model and migration approach.
- [ ] Sketch desktop/mobile navigation and key screens.
- [ ] Obtain a fresh Google Contacts CSV export/template for field compatibility tests.

**Exit criteria:** Reviewed data model, screen map, and acceptance criteria.

### Phase 1 — Core Contacts and Groups (v0.1 milestone A)

- [ ] Implement signup/sign-in and isolated user accounts.
- [ ] Implement create/read/update/archive of people and contact methods.
- [ ] Implement contact profile and photo support.
- [ ] Implement user-created groups and many-to-many group membership.
- [ ] Implement searching, filtering, and pinned contacts.
- [ ] Test that user A cannot view or edit user B's private records.

**Exit criteria:** Users can privately manage people and groups on desktop and mobile.

### Phase 2 — Import, Export, and Group Sharing (v0.1 milestone B)

- [ ] Implement Google Contacts CSV parser and import preview.
- [ ] Implement label-to-group creation/membership.
- [ ] Implement duplicate review with create/merge/skip.
- [ ] Implement Google Contacts CSV export with verified field mapping.
- [ ] Implement standard CSV export.
- [ ] Implement group-sharing invitation and independent-copy import.
- [ ] Test repeated imports/shares, special characters, multiple contact methods, and privacy exclusions.

**Exit criteria:** Google Contacts CSV import/export works reliably; sharing copies only approved basic contact fields.

### Phase 3 — Relationship Features (v0.1 milestone C)

- [ ] Implement general notes and dated journals.
- [ ] Implement optional contact intervals with N/A default.
- [ ] Implement reminders dashboard and follow-up overrides.
- [ ] Implement relationships and household associations.
- [ ] Implement activities and multiple participants.
- [ ] Verify private content never leaks through sharing or default exports.

**Exit criteria:** Relationship tracking is useful but optional, without burdening ordinary contacts.

### Phase 4 — Polish, Help, and Release (v0.1)

- [ ] Add **About** with mission, app version, and Dennis Senior credit.
- [ ] Add **Help / Instructions** and contextual help links.
- [ ] Complete mobile accessibility and usability review.
- [ ] Add clear empty states, validation, confirmation prompts, and success/error messages.
- [ ] Test import/export round trips, permissions, and recovery from interrupted operations.
- [ ] Test backups, security, and privacy behavior.
- [ ] Release v0.1 and publish change notes.

**Exit criteria:** A new user can create an account, import Google contacts, manage groups, share a group, export for Google Contacts, and use notes/reminders with guidance.

### Post-v0.1 — Candidates, Not Committed

- [ ] Optional manual refresh/re-share of a previously copied group (no automatic synchronization by default).
- [ ] Selected-contact sharing independent of a whole group.
- [ ] Advanced custom fields and configurable views.
- [ ] Contact/household maps and proximity filters.
- [ ] Enhanced photo galleries and person-specific keepsake/memory-book export.
- [ ] More advanced reminders, notifications, and calendar integrations.
- [ ] Optional selective collaboration with granular permissions, designed separately from copy-based sharing.

## 7. Acceptance Checklist for v0.1

- [ ] Two users can sign in and manage their contact databases independently.
- [ ] One person can belong to multiple groups.
- [ ] A person with contact schedule **N/A** never appears overdue solely due to elapsed time.
- [ ] Sharing a group copies only basic fields and lets recipients create/use a group and review duplicates.
- [ ] Changes after sharing do not automatically change the recipient's records.
- [ ] A Google Contacts CSV import creates appropriate contacts and groups, including multiple labeled contact methods.
- [ ] A Google Contacts CSV export imports into Google Contacts successfully with expected labels and fields.
- [ ] Default exports and group shares reveal no notes, journals, histories, reminders, activities, or priority flags.
- [ ] Help / Instructions explains each major workflow in plain language.
- [ ] About displays the approved mission and **Created and Developed by Dennis Senior**.

## 8. Open Decisions for Build Planning

- Final public app name and branding (working name: People Tracker).
- Web app, installable PWA, or native mobile targets.
- Authentication method and how sharing recipients are found/invited.
- Whether general notes should ever be available as an explicit opt-in export in a separate personal backup format.
- Exact duplicate-matching rules and conflict-resolution UX.
- Backup/restore and account deletion/export workflows.

---

*This document records the agreed initial scope and a proposed implementation sequence. Roadmap checkboxes represent planned work, not completed functionality.*
