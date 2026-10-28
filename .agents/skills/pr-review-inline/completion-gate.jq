def nonempty_string: type == "string" and length > 0;

. as $review |
.schema == 1 and
.head_sha == $sha and
.reconciliation_complete == true and
.findings_verified == true and
(.required_reviewers | type == "array") and
(.required_reviewers | length > 0) and
(all(.required_reviewers[]; nonempty_string)) and
((.required_reviewers | unique | length) == (.required_reviewers | length)) and
(.reviewers | type == "array") and
all($review.required_reviewers[];
  . as $id |
  [$review.reviewers[] | select(.id == $id)] as $results |
  ($results | length) == 1 and
  ($results[0] |
    .status == "completed" and
    .reviewed_sha == $sha and
    .evidence_verified == true and
    (.report_path | nonempty_string) and
    (.result_ref | nonempty_string)
  )
)
