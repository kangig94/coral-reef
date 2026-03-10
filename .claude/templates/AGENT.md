# Agent Template

All agents use `<Agent_Prompt>` XML structure.

```yaml
---
name: <agent-name>
description: "<description>. Use when [trigger]. NOT for [exclusion]."
model: <opus|sonnet>
---
```

```xml
<Agent_Prompt>
  <Role>
    You are [role]. Your mission is [mission].
    You are responsible for: [responsibilities].
    You are NOT responsible for: [exclusions with agent names].

    | Situation | Priority |
    |-----------|----------|
    | [trigger condition] | MANDATORY / RECOMMENDED / OPTIONAL |
  </Role>
  <Success_Criteria>
    - [Measurable criterion 1]
    - [Measurable criterion 2]
  </Success_Criteria>
  <Constraints>
    [ONE-LINE IRON LAW IN CAPS]

    | DO | DON'T |
    |----|-------|
    | [correct behavior] | [incorrect behavior] |
  </Constraints>
  <Output_Format>
    ## Report Title
    ### Section
    | Column | Column |
    |--------|--------|
  </Output_Format>
</Agent_Prompt>
```

## Required Sections (WHO / WHAT / GUARD / FORMAT)

| Section | Description |
|---------|-------------|
| `Role` | WHO — core responsibility + explicit NOT-responsible boundaries + When to Invoke table |
| `Success_Criteria` | WHAT — measurable completion criteria with BLOCKING/STRONG/MINOR hierarchy |
| `Constraints` | GUARD — iron law + DO/DON'T table |
| `Output_Format` | FORMAT — structured output template with tables |

## Optional Sections

| Section | When to Include |
|---------|-----------------|
| `Why_This_Matters` | Tier 0 and Tier 1 agents — explains the design philosophy |
| `Investigation_Protocol` | Agent has a multi-step procedure to follow |
| `Tool_Usage` | Agent uses specific detection commands or depends on key files |
| `Failure_Modes_To_Avoid` | Common mistakes specific to this agent's domain |

## Frontmatter Options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | kebab-case agent name |
| `description` | yes | One-line with "Use when... NOT for..." |
| `model` | yes | `opus` (tier 1 safety/orchestration) or `sonnet` (tier 2-3 domain/quality) |

## Tier Reference

| Tier | Model | Examples |
|------|-------|---------|
| 0 (orchestration) | opus | review-orchestrator |
| 1 (safety) | opus | api-guardian, async-safety, state-guardian |
| 2 (domain) | sonnet | domain-specific reviewers |
| 3 (quality) | sonnet | code-critic, doc-critic, test-critic |
