"use strict";
(async function () {
  function timeZoneOffset() {
    // extract GMT+offset from current time zone, if available
    return new Date()
      .toString()
      .split(" ")
      .filter((s) => s.includes("GMT"))
      .map((s) => `(${s})`);
  }

  function buildPlotLayout() {
    const offset = timeZoneOffset();
    const layout = {
      height: 600,
      width: 1200,
      xaxis: {
        title: { text: `Time of benchmark run ${offset}` },
        type: "date",
      },
    };

    return layout;
  }

  function addTitleToElement(parent, title) {
    const titleElem = document.createElement("h1");
    titleElem.className = "benchmark-title";
    titleElem.textContent = title;
    parent.appendChild(titleElem);
  }

  function chartFilteredTraces(parent, title, filteredTraces) {
    // return if no datasets
    if (filteredTraces.length == 0) {
      console.error(`No datasets found with ${title}`);
      return;
    }

    // adjust data to have the appropriate unit
    const unit = adjustDataAndUnit(filteredTraces);

    // create elem for plot
    const elem = document.createElement("div");
    elem.className = "benchmark-graphs";
    parent.appendChild(elem);

    const layout = buildPlotLayout();

    // get the unit from the first item
    // this is possible because there is at least one data point,
    // and the unit is the same across all data points.
    layout.yaxis = { title: { text: `Value (${unit})` } };

    layout.title = { text: title };

    // add the plot to the elem
    Plotly.newPlot(elem, filteredTraces, layout);

    // return the element
    return elem;
  }

  function buildKey(benchItem, schema) {
    // build the key from the values in the schema
    const key = {};
    for (const s of schema) {
      if (benchItem.hasOwnProperty(s)) {
        key[s] = benchItem[s].toString();
      } else {
        key[s] = "-";
      }
    }

    return JSON.stringify(key);
  }

  function parseKey(keyString, schema) {
    const key = JSON.parse(keyString);
    for (const s of schema) {
      if (!key.hasOwnProperty(s)) {
        // explicitly set to `undefined`
        key[s] = "-";
      }
    }
    return key;
  }

  function getNanoseconds(value, unit) {
    // XXX: should unify unit format in action output
    // XXX: assumes duration
    const unitIdentifier = unit[0];

    let newValue;
    switch (unitIdentifier) {
      // micro
      case "\u03bc":
      case "\u00b5":
      case "u":
        newValue = value * 1000;
        break;
      case "n":
        newValue = value;
        break;
      case "m":
        newValue = value * 1000000;
        break;
      case "s":
        newValue = value * 1000000000;
        break;
      default:
        throw new Error(`undefined unit: ${unitIdentifier}`);
    }
    return newValue;
  }

  // adjust all data to same unit and get optimal unit
  // returns the unit, and adjusts the traces in place
  function adjustDataAndUnit(traces) {
    // get the max value across all traces
    const maxes = traces.map((trace) => Math.max(...trace.dataNs));
    const maxValue = Math.max(...maxes);

    // determine best unit
    let scaleFactor;
    let unit;
    if (maxValue > 1000000000) {
      scaleFactor = 1000000000.0;
      unit = "s/iter";
    } else if (maxValue > 1000000) {
      scaleFactor = 1000000.0;
      unit = "ms/iter";
    } else if (maxValue > 1000) {
      scaleFactor = 1000.0;
      unit = "\u03BCs/iter";
    } else {
      scaleFactor = 1.0;
      unit = "ns/iter";
    }
    // add the correct y axis data
    traces.forEach((trace) => {
      trace.y = trace.dataNs.map((d) => d / scaleFactor);
    });

    return unit;
  }

  // separates the data into traces by key
  function separateAllTraces(commits, schema) {
    // flatten and keep commit data
    const data = commits
      .map((commitEntry) => {
        const { commit, date, benches } = commitEntry;
        return benches.map((bench) => {
          return { commit, date, bench };
        });
      })
      .flat();

    // group by key
    const groupedData = Object.groupBy(data, (benchEntry) => {
      return buildKey(benchEntry.bench, schema);
    });

    // prepare for plotting
    const traces = Object.entries(groupedData).map(([keyString, dataset]) => {
      const metadata = parseKey(keyString, schema);
      // first convert to nanoseconds
      const dataNs = dataset.map((d) =>
        getNanoseconds(d.bench.value, d.bench.unit)
      );
      metadata.unit = "ns/iter";

      return {
        metadata,
        x: dataset.map((d) => new Date(d.date)),
        // y will be constructed later
        dataNs,
        dataset,
        showlegend: true,
        hoverinfo: "text",
      };
    });

    return Array.from(traces);
  }

  // get the correct schema object from `window.BENCHMARK_DATA`,
  // and return a default value if invalid or none is provided.
  function retrieveSchema(benchSet) {
    const defaultSchema = [
      "name",
      "platform",
      "os",
      "keySize",
      "api",
      "category",
    ];

    let schema = window.BENCHMARK_DATA.schema;
    if (
      !schema || typeof schema !== "object" || !schema.hasOwnProperty(benchSet)
    ) {
      console.error(
        `No or invalid schema provided: defaulting to [${defaultSchema}]`,
      );
      return defaultSchema;
    }

    return schema[benchSet];
  }
  // get the correct groupBy object from `window.BENCHMARK_DATA`,
  // and return a default value if invalid or none is provided.
  function retrieveGroupBy(benchSet) {
    const defaultGroupBy = ["os"];
    let groupBy = window.BENCHMARK_DATA.groupBy;
    if (
      !groupBy || typeof groupBy !== "object" ||
      !groupBy.hasOwnProperty(benchSet)
    ) {
      console.error(
        `No or invalid groupBy provided: defaulting to [${defaultGroupBy}]`,
      );
      return defaultGroupBy;
    }
    return groupBy[benchSet];
  }

  // build the groupKey for a trace,
  // which consists of the key-value pairs
  // for the groupBy keys only.
  function buildTraceGroupKey(trace, groupBy) {
    const traceGroup = {};
    for (let key of groupBy) {
      traceGroup[key] = trace.metadata[key];
    }
    return JSON.stringify(traceGroup);
  }
  function getObservationTooltipText(name, observation) {
    const value = observation.bench.value;
    const unit = observation.bench.unit;
    const range = observation.bench.range;
    const commitId = observation.commit.id;
    const message = observation.commit.message;
    const url = observation.commit.url;
    const rangeText = range ? range : "";

    return `<b>${name}</b><br>value: ${value} ${unit} ${rangeText}<br>commit id: ${commitId}<br>commit name: ${message}<br>commit url: ${url}`;
  }
  // return the name for the graph legend,
  // using only the metadata entries that are not included in the
  // groupBy, and are not 'unit'.
  // also, don't include the fields whose values are `undefined` in the name.
  function getLegendName(trace, groupBy, schema) {
    // entries sorted by schema
    const orderedEntries = schema.map((key) => [key, trace.metadata[key]]);

    return orderedEntries
      .filter(([key, value]) =>
        !groupBy.includes(key) && key !== "unit" && value !== undefined
      )
      .map(([_, value]) => value)
      .join(" ");
  }
  function addLegendNameAndTooltip(trace, groupBy, schema) {
    // set the name in the legend
    trace.name = getLegendName(trace, groupBy, schema);

    // set the tooltip text
    trace.text = trace.dataset.map((observation) =>
      getObservationTooltipText(trace.name, observation)
    );
  }

  // Display the fields in the group as a comma-separated list
  function buildTitleFromGroupKey(groupKey, groupBy) {
    const entries = groupBy
      .map((field) => [field, groupKey[field]])
      .map(([field, value]) => {
        if (value === undefined) {
          return `undefined ${field}`;
        }
        return `the ${field} ${value}`;
      });

    if (entries.length === 0) {
      return "Results";
    }
    if (entries.length === 1) {
      return "Results for run with " + entries[0];
    }

    let joinedEntries = "";
    joinedEntries += entries.slice(0, entries.length - 1).join(", ");
    joinedEntries += " and " + entries[entries.length - 1];
    return "Results for run with " + joinedEntries;
  }
  function addAttributesToChartElement(elem, groupKey) {
    Object.entries(groupKey).forEach(([key, value]) => {
      elem.setAttribute(key, value);
    });
  }

  function setChartHiddenStatus(hide, key, value) {
    const charts = document.getElementsByClassName("benchmark-graphs");
    const filteredCharts = Array.from(charts).filter((chart) => {
      const chartValue = chart.getAttribute(key);
      return chartValue === value;
    });
    filteredCharts.forEach((chart) => {
      let hiddenByAttribute = chart.getAttribute("hidden-by");
      let hiddenBy = hiddenByAttribute ? hiddenByAttribute : 0;

      if (hide) {
        chart.style.setProperty("display", "none");
        hiddenBy += 1;
      } else {
        if (hiddenBy) {
          hiddenBy -= 1;
        } else {
          hiddenBy = 0;
        }

        // only unhide if not hidden by another
        if (hiddenBy == 0) {
          chart.style.setProperty("display", null);
        }
      }
      chart.setAttribute("hidden-by", hiddenBy);
    });
  }

  function getUniqueValuesForKey(groupKeys, groupBy) {
    // get the unique values for each group
    const uniqueValues = {};
    groupBy.forEach((key) => {
      const keys = groupKeys.map((k) => k[key]);
      const set = [...new Set(keys)];
      uniqueValues[key] = set;
    });

    return uniqueValues;
  }

  function createFilterInterface(elem, groupKeys, groupBy) {
    elem.className = "filter-interface";
    const uniqueValues = getUniqueValuesForKey(groupKeys, groupBy);

    Object.entries(uniqueValues).forEach(([key, values]) => {
      const checklist = document.createElement("div");
      checklist.className = "checklist";

      const title = document.createElement("div");
      title.className = "checklist-title";
      title.textContent = key;
      checklist.appendChild(title);

      values.forEach((value) => {
        // generate the filter interface from the unique values
        const wrapper = document.createElement("div");
        wrapper.className = "checklist-entry";

        // id to match checkbox to label
        const id = `${key}-${value}`;

        // single checkbox with label
        const checkBox = document.createElement("input");
        checkBox.setAttribute("type", "checkbox");
        checkBox.setAttribute("id", id);

        // start with checkbox checked
        checkBox.checked = true;

        // set the key and value attributes
        checkBox.setAttribute("key", key);
        checkBox.setAttribute("value", value);

        // create the label for the checkbox
        const label = document.createElement("label");
        label.setAttribute("for", id);
        label.textContent = value ? value : "undefined";

        checkBox.addEventListener("change", function () {
          const key = this.getAttribute("key");
          const value = this.getAttribute("value");
          if (this.checked) {
            setChartHiddenStatus(false, key, value);
          } else {
            setChartHiddenStatus(true, key, value);
          }
        });
        wrapper.appendChild(checkBox);
        wrapper.appendChild(label);

        checklist.appendChild(wrapper);
      });

      elem.appendChild(checklist);
    });
  }

  function populateBenchSetDropdown(names) {
    let elem = document.getElementById("benchmark-set-dropdown");
    elem.innerHTML = "";

    // if there is one or fewer names, remove the dropdown
    if (names.length === 0) {
      return;
    }
    const label = document.createElement("label");
    label.setAttribute("for", "bench-set-dropdown");
    elem.appendChild(label);

    const select = document.createElement("select");
    select.id = "bench-set-dropdown";
    elem.appendChild(select);

    names.forEach((name) => {
      const option = document.createElement("option");
      option.setAttribute("value", name);
      option.textContent = name;
      select.appendChild(option);
    });
    select.addEventListener("change", async function () {
      const benchSet = this.value;
      renderAllCharts(benchSet);
    });
  }

  function renderAllCharts(benchSet) {
    const main = document.getElementById("body");
    main.innerHTML = "";

    // retrieve the data
    const entry = window.BENCHMARK_DATA.entries[benchSet];

    // retrieve the custom metadata schema from `window.BENCHMARK_DATA`
    // each combination of fields is used to uniquely identify a trace
    const schema = retrieveSchema(benchSet);

    // build the data traces by separating out the observations
    // by key. This is equivalent to separating out the observations
    // by benchmark id, except that the benchmark id consists
    // of multiple, separate fields.
    const traces = separateAllTraces(entry, schema);

    // get the groupBy information from `window.BENCHMARK_DATA`
    // this is an array of keys, e.g. ['os', 'keySize']
    // there should be one plot per combination of these values
    const groupBy = retrieveGroupBy(benchSet);

    // create a div for the filter interface
    const filterElem = document.createElement("div");
    filterElem.className = "filter-interface";

    // create a div for the benchmark set
    const setElem = document.createElement("div");
    setElem.className = "benchmark-set";
    addTitleToElement(setElem, `${benchSet} by ${groupBy}`);

    // group datasets by the relevant keys
    const groupedData = Object.groupBy(
      traces,
      (trace) => buildTraceGroupKey(trace, groupBy),
    );
    const groupKeys = Object.keys(groupedData).map((keyString) =>
      parseKey(keyString, groupBy)
    );

    // create the interface at the top of the page for filtering
    createFilterInterface(filterElem, groupKeys, groupBy);

    // create  a chart for each group
    Object.entries(groupedData).forEach(([groupKeyString, filteredTraces]) => {
      // build the title
      const groupKey = parseKey(groupKeyString, groupBy);
      const title = buildTitleFromGroupKey(groupKey, groupBy);

      // add the legend name to each trace,
      // as well as the tooltip text for each point in each trace
      filteredTraces.forEach((trace) =>
        addLegendNameAndTooltip(trace, groupBy, schema)
      );

      const chartElem = chartFilteredTraces(setElem, title, filteredTraces);
      if (chartElem) {
        addAttributesToChartElement(chartElem, groupKey);
      }
    });

    main.appendChild(filterElem);
    main.appendChild(setElem);
  }

  async function loadDataFromUrl(url) {
    return fetch(url)
      .catch((e) => {
        throw new Error(`Error retrieving data from ${url}: ${e}`);
      })
      .then((response) => response.json());
  }

  function rerenderAll() {
    // retrieve the data for the benchmark set with the first name
    const benchSets = window.BENCHMARK_DATA.entries;
    const [benchSet, entry] = Object.entries(benchSets)[0];

    // build the dropdown for all benchmark sets
    populateBenchSetDropdown(Object.keys(benchSets));
    renderAllCharts(benchSet);
  }

  async function init() {
    const data = window.BENCHMARK_DATA;
    const metadata = window.METADATA;

    const lastUpdateElem = document.getElementById("last-update");
    const repoLinkElem = document.getElementById("repository-link");
    const prLinkElem = document.getElementById("pr-link");
    const commitLinkElem = document.getElementById("commit-link");

    // Render header
    lastUpdateElem.textContent = new Date(data.lastUpdate).toString();
    repoLinkElem.href = data.repoUrl;
    repoLinkElem.textContent = data.repoUrl;

    prLinkElem.href = metadata.prUrl;
    prLinkElem.textContent = metadata.prLabel;

    commitLinkElem.href = metadata.commitUrl;
    commitLinkElem.textContent = metadata.commitLabel;

    rerenderAll();
  }

  await init();
})();
