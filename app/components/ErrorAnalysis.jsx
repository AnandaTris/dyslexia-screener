"use client";

const CATEGORY_LABELS = {
  phonological: "Phonological",
  orthographic: "Orthographic",
  morphological: "Morphological",
  visual: "Visual",
  homophone: "Homophone",
  segmentation: "Word boundary",
  grammatical: "Grammatical",
};

const PROFILE_LABELS = {
  phonological: "Phonological",
  surface: "Surface / orthographic",
  morphological: "Morphological",
  visual: "Visual",
};

function percent(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

export default function ErrorAnalysis({ analysis }) {
  if (!analysis?.ok) return null;

  const { profile, errors, categoryCounts, recurringPatterns, repeatedWords, caveats, pipeline, statistics } =
    analysis;

  const profileEntries = Object.entries(profile.scores ?? {})
    .filter(([, share]) => share > 0)
    .sort((a, b) => b[1] - a[1]);

  const categoryEntries = Object.entries(categoryCounts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section className="analysis" aria-label="Error pattern analysis">
      <h3 className="section-label">Error pattern analysis</h3>
      <p className="summary">{analysis.summary}</p>

      <div className={`profile-banner ${profile.dominant ? `p-${profile.dominant}` : "p-none"}`}>
        <div className="profile-head">
          <span className="profile-label">{profile.label}</span>
          {profile.dominant && (
            <span className="profile-confidence">
              Confidence {percent(profile.confidence)}
            </span>
          )}
        </div>
        <p className="profile-description">{profile.description}</p>

        {profileEntries.length > 0 && (
          <dl className="profile-bars">
            {profileEntries.map(([key, share]) => (
              <div className="profile-bar-row" key={key}>
                <dt>{PROFILE_LABELS[key] ?? key}</dt>
                <dd>
                  <div className="profile-bar">
                    <div
                      className={`profile-bar-fill p-${key}`}
                      style={{ width: percent(share) }}
                    />
                  </div>
                  <span className="profile-bar-value">{percent(share)}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {profile.intervention && (
          <p className="profile-intervention">
            <strong>Where to focus teaching:</strong> {profile.intervention}
          </p>
        )}
      </div>

      {categoryEntries.length > 0 && (
        <>
          <h4 className="section-label">Errors by category</h4>
          <ul className="chip-row">
            {categoryEntries.map(([category, count]) => (
              <li key={category} className={`chip c-${category}`}>
                {CATEGORY_LABELS[category] ?? category}
                <span className="chip-count">{count}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {errors.length > 0 && (
        <>
          <h4 className="section-label">Every error found ({errors.length})</h4>
          <table className="error-table">
            <thead>
              <tr>
                <th scope="col">Written</th>
                <th scope="col">Intended</th>
                <th scope="col">Category</th>
                <th scope="col">Sounds right?</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((error, i) => (
                <tr key={`${error.produced}-${i}`}>
                  <td className="err-produced">{error.produced}</td>
                  <td className="err-target">{error.target}</td>
                  <td>
                    <span className={`chip c-${error.category}`}>
                      {CATEGORY_LABELS[error.category] ?? error.category}
                    </span>
                    <span className="err-subtype">{error.subtypeLabel}</span>
                  </td>
                  <td className="err-sound">
                    {error.soundsLikeTarget ? "Yes" : "No"}
                    <span className="err-sim">{percent(error.phoneticSimilarity)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {recurringPatterns?.length > 0 && (
        <>
          <h4 className="section-label">Recurring patterns</h4>
          <ul className="pattern-list">
            {recurringPatterns.map((pattern) => (
              <li key={pattern.pattern}>
                <code>{pattern.pattern}</code>
                <span className="pattern-count">{pattern.count}×</span>
                <span className="pattern-examples">{pattern.examples.join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {repeatedWords?.length > 0 && (
        <>
          <h4 className="section-label">Words misspelled more than once</h4>
          <ul className="pattern-list">
            {repeatedWords.map((word) => (
              <li key={word.target}>
                <code>{word.target}</code>
                <span className="pattern-count">{word.count}×</span>
                <span className="pattern-examples">
                  {word.spellings.join(", ")}
                  {word.inconsistent && " — spelled inconsistently"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {caveats?.length > 0 && (
        <>
          <h4 className="section-label">Read this with the findings</h4>
          <ul className="caveats">
            {caveats.map((caveat, i) => (
              <li key={i}>{caveat}</li>
            ))}
          </ul>
        </>
      )}

      <p className="pipeline-note">
        {statistics.words} words · {statistics.sentences} sentences · layers:{" "}
        {Object.entries(pipeline.layers)
          .map(([layer, on]) => `${layer}${on ? "" : " (off)"}`)
          .join(", ")}
        {pipeline.neuralModel && ` · model: ${pipeline.neuralModel}`}
        {pipeline.neuralReason && ` · ${pipeline.neuralReason}`}
      </p>
    </section>
  );
}
