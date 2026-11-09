---
name: metaview-candidate-brief
description: Prep me for my interview with a candidate, brief me before a round, build a debrief or evidence pack, compare candidates or finalists for a role, check a scorecard against the transcript, or draft my interview feedback or scorecard, from Metaview. Builds a sourced brief and leaves every hiring decision to the user. Load with metaview before the first Metaview tool call. Not for non-hiring meetings or calls (granola-meeting-brief).
---

If Metaview's tools are absent, run `/connect` and choose Metaview, or on Jelly call jelly_connection_request.

# Candidate brief

Uses the `metaview` skill's steps to find people and conversations; this skill decides what to read and how to write it
up. Everything here is read-only: nothing is saved to Metaview or the ATS.

## Inputs

- Each candidate's full name (resolve each one separately with `list_field_values` on `default:candidate`), the role,
  and what this round assesses.
- A rubric or job description, if the user has one: ask once. Without one, derive the competencies from what
  interviewers actually probed, and say that you did.

## Collect

1. `get_user_context` once: if the user is a member, the brief must say it may miss rounds they cannot see.
2. Per candidate: `search_conversations` on the candidate filter, no `fields` first. List every round with interviewer,
   date and stage (the event title). Unrecorded rounds count in coverage but are never cited.
3. Read at the depth the count calls for: summaries for a typical 3-5 round loop, then at most one or two transcripts
   (`limit` 5 or less) for the round that matters most or for a point the summaries disagree on.
4. `fetch_candidates` for the profile and the ATS scorecards. A missing ATS part is "not available", not "none".
5. Sources stop there. A calendar may give only this interview's own time and title, when Metaview lacks them: ask for
   those fields alone (no attendees or descriptions), and never name or list other meetings. Never search mail, chat,
   Drive or the web for the candidate, or try variants of their name, unless the user asks. Nothing found in Metaview:
   say so, as the `metaview` skill's "An empty result" says, and ask for the candidate's email or the role.

## Prep brief (before a round)

1. TL;DR: three lines.
2. Snapshot: role, current company and tenure, location. Notice period or work authorisation only if discussed, with
   the round it came from.
3. Covered so far: one line per round (interviewer, date, link) and what it tested.
4. Signal so far, with each point linked; contradictions between rounds; scorecard claims the transcript doesn't support.
5. Gaps this round should fill.
6. 6-10 questions tied to the candidate's own claims ("you said you led the migration at 12:40; what did you own?").
7. The candidate's side: their questions, timeline, other processes.

Short notice: lead with the TL;DR and the questions. Label every Metaview summary or AI note you used as Metaview's.

## Debrief or comparison

An evidence matrix: competency × round, each cell what was tested, evidence for, evidence against, and who assessed it,
with a link and time range.

- A competency no round tested reads "no evidence": unknown, never a weakness.
- Where rounds or a scorecard and its transcript disagree, show both sides.
- For several candidates, put them side by side per competency. **No ranking, overall score or "hire X".** Asked "who
  should we hire", lay out the evidence, say the decision is the user's or the panel's, and name what would settle the
  open points (a reference check, a follow-up question, a work sample).

## Draft feedback or a scorecard

For "draft my scorecard for the call I just had": find the call (the candidate filter, or `default:interviewer` with
`"$self"` and a recent relative date dict), read its transcript, and write per criterion what the candidate said, with
its time in the call. Leave the overall recommendation or rating blank for the user to fill in, and say nothing was
saved to Metaview or the ATS. No comments on personality, accent, age or appearance.

## Sensitive content

- Compensation, visa or right to work and notice: only when decision-relevant and stated, labelled "as stated in <round>".
  Health, family and protected characteristics: never, and never speculated.
- Anything meant for the candidate or a new manager leaves out compensation and interviewer evaluations.

## Follow-ups, only when asked

- Sending the brief to a document, Slack or email: the user names the destination; confirm it and what is left out.
- A Metaview candidate pack or debrief note (`generate_notes`, `manage_notes_sources`) is a change: load `metaview-write`.
