export var Session = {
  view: ({attrs}) => {
    return m("div", {"class":"session"},
      m("div", {"class":"mb-4"},
        [
          m("div", {"class":"date"}, attrs.date),
          // m("div", {"class":"summary"}, attrs.summary),
          m("div", {"class":"participants"},
            `Participants: ${(attrs.participants||[]).join(', ')}`
          ),
        ]
      ),
      m("div", {"class":"entries", "id": "entries"},
        (attrs.entries||[]).map(entry => m(Entry, entry))
      )
    )
  }
}

export var Entry = {
  view: ({attrs}) => {
    return m("div", {"class":"entry", "data-start": attrs.span.start, "data-end": attrs.span.end}, [
      m("div", {"class":"left"},
        m("div", {"class":"time"}, formatTime(attrs.start), "-", formatTime(attrs.end)),
      ),
      m("div", {"class":"line","style":{"background-color":attrs.lineColor}},
        m("div", {"class":`right ${attrs.isAssistant ? "assistant": ""}`},
          m("div", {"class": "text text-teal-500 space-x-4"}, attrs.speakers.length == 0 ? "unknown" : attrs.speakers.map(s => {
            return m("span", {"class": `text-${s.color}`, "data-speaker-id": s.id}, s.name);
          })),
          m("div", {"class": `text ${!attrs.final ? "text-gray-400": "text-slate-300"}`, lang: attrs.lang},
            attrs.words.map(w => {
              return m("span", {
                "class": w.colors.length == 0 ? "" : `underline decoration-${w.colors[0]}/50`,
                "data-start": w.start, "data-end": w.end,
              }, w.word);
            })
          ),
          attrs.translations.map(translation =>
            m("div", {"class": "text text-cyan-500", lang: translation.lang},
              translation.text,
            )
          ),
          attrs.assistants.map(asst =>
            m("div", {"class": "text text-fuchsia-500 whitespace-pre-wrap"},
              m("b", asst.name),
              " ", asst.text,
            )
          ),
          attrs.tools.map(evt =>
            m("div", {"class": "text text-fuchsia-500 whitespace-pre-wrap"},
              m("div", m("b", evt.name)),
              m("div", m("b", "Called"), " ", JSON.stringify(evt.call)),
              m("div", m("b", "Response"), " ", JSON.stringify(evt.response)),
            )
          ),
        )
      )
    ])
  }
}

const timeFmt = new Intl.DateTimeFormat("en-us", {timeStyle: "medium"});

function formatDuration(seconds) {
  if (seconds > 59 * 60) {
    return `${Math.round(seconds / 3600)} hour${seconds > (3600 * 1.5) ? 's': ''}`
  }

  if (seconds > 45) {
    return `${Math.round(seconds / 60)} minute${seconds > 90 ? 's': ''}`
  }

  return `${Math.round(seconds)} seconds`
}

function formatTime(time) {
  return timeFmt.format(time)
}

function formatSessionTime(seconds) {
  let hours = Math.floor(seconds / 3600)
  seconds -= hours * 3600
  let minutes = Math.floor(seconds / 60)
  seconds -= minutes * 60
  return `${hours < 10 ? '0' : ''}${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}
