{
  "displayName": "${display_name}",
  "mosaicLayout": {
    "columns": 12,
    "tiles": [
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Request Rate",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/request_count\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM",
                    "groupByFields": ["metric.label.response_code_class"]
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Requests/sec",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "xPos": 6,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Error Rate",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"logging.googleapis.com/user/mcp_bigquery_error_count_${environment}\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Errors/min",
              "scale": "LINEAR"
            },
            "thresholds": [{
              "value": 5.0,
              "color": "YELLOW",
              "direction": "ABOVE"
            }]
          }
        }
      },
      {
        "yPos": 4,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Request Latency (P50, P95, P99)",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/request_latencies\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_DELTA",
                      "crossSeriesReducer": "REDUCE_PERCENTILE_50"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1",
                "legendTemplate": "P50"
              },
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/request_latencies\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_DELTA",
                      "crossSeriesReducer": "REDUCE_PERCENTILE_95"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1",
                "legendTemplate": "P95"
              },
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/request_latencies\"",
                    "aggregation": {
                      "alignmentPeriod": "60s",
                      "perSeriesAligner": "ALIGN_DELTA",
                      "crossSeriesReducer": "REDUCE_PERCENTILE_99"
                    }
                  }
                },
                "plotType": "LINE",
                "targetAxis": "Y1",
                "legendTemplate": "P99"
              }
            ],
            "yAxis": {
              "label": "Latency (ms)",
              "scale": "LINEAR"
            },
            "thresholds": [{
              "value": 2000.0,
              "color": "YELLOW",
              "direction": "ABOVE"
            }]
          }
        }
      },
      {
        "xPos": 6,
        "yPos": 4,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "BigQuery Query Latency",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"logging.googleapis.com/user/mcp_bigquery_query_latency_${environment}\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_DELTA",
                    "crossSeriesReducer": "REDUCE_PERCENTILE_95",
                    "groupByFields": ["metric.label.query_type"]
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Latency (ms)",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "yPos": 8,
        "width": 4,
        "height": 4,
        "widget": {
          "title": "Instance Count",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/container/instance_count\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Instances",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "xPos": 4,
        "yPos": 8,
        "width": 4,
        "height": 4,
        "widget": {
          "title": "Memory Utilization",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/container/memory/utilizations\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN",
                    "crossSeriesReducer": "REDUCE_MEAN"
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Utilization",
              "scale": "LINEAR"
            },
            "thresholds": [{
              "value": 0.85,
              "color": "YELLOW",
              "direction": "ABOVE"
            }]
          }
        }
      },
      {
        "xPos": 8,
        "yPos": 8,
        "width": 4,
        "height": 4,
        "widget": {
          "title": "CPU Utilization",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"run.googleapis.com/container/cpu/utilizations\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN",
                    "crossSeriesReducer": "REDUCE_MEAN"
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Utilization",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "yPos": 12,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Authentication Failures",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"logging.googleapis.com/user/mcp_bigquery_auth_failures_${environment}\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE"
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Failures/min",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "xPos": 6,
        "yPos": 12,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "BigQuery Bytes Processed",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"logging.googleapis.com/user/mcp_bigquery_bytes_processed_${environment}\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Bytes/sec",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "yPos": 16,
        "width": 12,
        "height": 4,
        "widget": {
          "title": "Recent Errors (Last 100)",
          "logsPanel": {
            "resourceNames": ["projects/${project_id}"],
            "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" severity>=ERROR"
          }
        }
      },
      {
        "yPos": 20,
        "width": 6,
        "height": 3,
        "widget": {
          "title": "Availability SLO (30 days)",
          "scorecard": {
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "select_slo_health(\"projects/${project_id}/services/mcp-bigquery-${environment}/serviceLevelObjectives/availability\")"
              }
            },
            "sparkChartView": {
              "sparkChartType": "SPARK_LINE"
            },
            "thresholds": [{
              "value": 0.999,
              "color": "YELLOW",
              "direction": "BELOW"
            }]
          }
        }
      },
      {
        "xPos": 6,
        "yPos": 20,
        "width": 6,
        "height": 3,
        "widget": {
          "title": "Latency SLO (30 days)",
          "scorecard": {
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "select_slo_health(\"projects/${project_id}/services/mcp-bigquery-${environment}/serviceLevelObjectives/latency\")"
              }
            },
            "sparkChartView": {
              "sparkChartType": "SPARK_LINE"
            },
            "thresholds": [{
              "value": 0.95,
              "color": "YELLOW",
              "direction": "BELOW"
            }]
          }
        }
      },
      {
        "yPos": 23,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Tool-Call Volume (by tenant / tool)",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"logging.googleapis.com/user/mcp_bigquery_tool_calls_${environment}\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM",
                    "groupByFields": ["metric.label.tenant_id", "metric.label.tool_name"]
                  }
                }
              },
              "plotType": "STACKED_BAR",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Calls/sec",
              "scale": "LINEAR"
            }
          }
        }
      },
      {
        "xPos": 6,
        "yPos": 23,
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Token Usage (by tenant)",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${service_name}\" metric.type=\"logging.googleapis.com/user/mcp_bigquery_token_usage_${environment}\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM",
                    "groupByFields": ["metric.label.tenant_id"]
                  }
                }
              },
              "plotType": "LINE",
              "targetAxis": "Y1"
            }],
            "yAxis": {
              "label": "Tokens/sec",
              "scale": "LINEAR"
            }
          }
        }
      }
    ]
  }
}
