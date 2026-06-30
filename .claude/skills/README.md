# Project skills

Skills here are **project-specific** and version-controlled with this repo.
They load on top of the org-wide skills that are baked into the base image
(`ghcr.io/getsomelemons/viking-claude-code`).

Two layers, two speeds:

| Layer | Where | When to use | How to update |
|-------|-------|-------------|---------------|
| Project skill | this repo, `.claude/skills/` | specific to this project; iterate fast | just edit, no rebuild |
| Image skill | the base image | useful across all projects | rebuild + push the image |

Workflow: prototype a skill here. Once it proves generally useful, **promote**
it — move the folder into the `viking-claude-code` repo's `skills/`, rebuild,
and push. Every future project then gets it for free.

Each skill is a subfolder with a `SKILL.md` (frontmatter `name` + `description`,
then instructions). See `mv3-extension/` for an example.
